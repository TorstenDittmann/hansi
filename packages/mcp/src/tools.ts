import { tierMeaning, type Tier } from '@hans/config';
import { schema, type Database, type ReviewStatus } from '@hans/db';
import { enqueueReview, type Queue } from '@hans/queue';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hasScope, type AuthenticatedKey } from './keys';

export const SERVER_INSTRUCTIONS = `Hansi reviews GitHub pull requests. These tools read reviews, open findings, and team learnings, and can request a new review.

A finding with status "posted" is still open. "resolved" means a later review saw the fix. "dismissed" means Hansi agreed it was not a problem. "dropped" was never posted.

Tier S means ready to merge. Open findings cap the tier: a minor finding means at most A, a major one at most B, a critical one at most D.

trigger_review spends the organization's model credits. Do not call it when the current head already has a completed review and nothing new has been pushed.

Learnings are rules injected into future reviews, for example "don't flag this in tests". Creating or deleting one, and triggering a review, requires a key with the write scope.`;

const MAX_QUEUED = 20;

export class ToolError extends Error {}

export interface McpToolContext {
	db: Database;
	queue: Queue;
	key: AuthenticatedKey;
}

const repositoryName = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.describe('GitHub repository, as owner/name');
const pullNumber = z.number().int().positive().describe('Pull request number');
const limit = z
	.number()
	.int()
	.positive()
	.max(100)
	.optional()
	.describe('Maximum results. Default 20');
const offset = z.number().int().nonnegative().max(10_000).optional().describe('Results to skip');

const reviewStatus = z.enum(schema.reviewStatuses);
const findingStatus = z.enum(['posted', 'resolved', 'dismissed', 'dropped']);

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	call: (ctx: McpToolContext, args: unknown) => Promise<unknown>;
}

export function mcpTools(): McpTool[] {
	return [
		tool(
			'whoami',
			'Return the organization and API key this connection is using. Call this first.',
			z.object({}),
			whoami
		),
		tool(
			'list_repositories',
			'List the GitHub repositories Hansi is installed on for this organization.',
			z.object({
				limit,
				offset,
				nameContains: z
					.string()
					.trim()
					.max(200)
					.optional()
					.describe('Case-insensitive substring of owner/name')
			}),
			listRepositories
		),
		tool(
			'list_reviews',
			'List Hansi reviews, newest first. Filter by repository, pull request, or status.',
			z.object({
				repository: repositoryName.optional(),
				pullNumber: pullNumber.optional(),
				status: reviewStatus
					.optional()
					.describe('queued, running, completed, failed, skipped, or superseded'),
				limit,
				offset
			}),
			listReviews
		),
		tool(
			'get_review',
			'Get one review: its tier, verdict, summary, and findings.',
			z.object({
				reviewId: z.string().uuid(),
				includeDropped: z
					.boolean()
					.optional()
					.describe('Include findings that were never posted. Default false')
			}),
			getReview
		),
		tool(
			'get_pull_request',
			'Get the latest Hansi review of a pull request and the findings that are still open. A finding with status posted is still open. Use this to see what to fix.',
			z.object({ repository: repositoryName, pullNumber }),
			getPullRequest
		),
		tool(
			'list_findings',
			'List findings. Status defaults to posted, which means still open. resolved and dismissed are closed. dropped was never posted.',
			z.object({
				repository: repositoryName.optional(),
				pullNumber: pullNumber.optional(),
				status: findingStatus.optional(),
				severity: z.enum(['info', 'minor', 'major', 'critical']).optional(),
				query: z
					.string()
					.trim()
					.min(1)
					.max(200)
					.optional()
					.describe('Substring of the title or body'),
				limit,
				offset
			}),
			listFindings
		),
		tool(
			'search_comments',
			'Search finding titles and bodies. By default only open findings are included.',
			z.object({
				query: z.string().trim().min(1).max(200),
				repository: repositoryName.optional(),
				includeResolved: z
					.boolean()
					.optional()
					.describe('Also include resolved and dismissed findings. Default false'),
				limit,
				offset
			}),
			searchComments
		),
		tool(
			'trigger_review',
			"Queue a review of a pull request's current head. This spends the organization's model credits. Do not call it when that head already has a completed review. Requires the write scope.",
			z.object({ repository: repositoryName, pullNumber }),
			triggerReview
		),
		tool(
			'list_learnings',
			'List review rules this team has saved. A rule with no repository applies to every repository. Passing a repository also returns those shared rules.',
			z.object({ repository: repositoryName.optional(), limit, offset }),
			listLearnings
		),
		tool(
			'create_learning',
			'Save a review rule for future reviews, for example "Don\'t flag missing error handling in scripts/". Requires the write scope.',
			z.object({
				body: z.string().trim().min(1).max(500),
				repository: repositoryName.optional().describe('Omit to apply the rule to every repository')
			}),
			createLearning
		),
		tool(
			'delete_learning',
			'Delete a learning by id. Requires the write scope.',
			z.object({ learningId: z.string().uuid() }),
			deleteLearning
		)
	];
}

function tool<T>(
	name: string,
	description: string,
	schema: z.ZodType<T>,
	run: (ctx: McpToolContext, args: T) => Promise<unknown>
): McpTool {
	const inputSchema = z.toJSONSchema(schema) as Record<string, unknown>;
	delete inputSchema.$schema;
	return {
		name,
		description,
		inputSchema,
		call: async (ctx, args) => {
			const parsed = schema.safeParse(args ?? {});
			if (!parsed.success) {
				throw new ToolError(
					parsed.error.issues
						.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
						.join('\n')
				);
			}
			return run(ctx, parsed.data);
		}
	};
}

function requireScope(ctx: McpToolContext, scope: 'read' | 'write') {
	if (!hasScope(ctx.key.scopes, scope)) {
		throw new ToolError(`This API key does not have the ${scope} scope.`);
	}
}

function page(input: { limit?: number; offset?: number }) {
	return { limit: input.limit ?? 20, offset: input.offset ?? 0 };
}

function iso(date: Date | null) {
	return date ? date.toISOString() : null;
}

function clip(text: string | null, max: number) {
	if (!text) return null;
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function contains(column: unknown, query: string) {
	return sql`instr(lower(${column}), ${query.toLowerCase()}) > 0`;
}

async function organization(ctx: McpToolContext) {
	const [row] = await ctx.db
		.select({
			id: schema.organization.id,
			name: schema.organization.name,
			slug: schema.organization.slug
		})
		.from(schema.organization)
		.where(eq(schema.organization.id, ctx.key.organizationId));
	if (!row) throw new ToolError("This API key's organization no longer exists.");
	return row;
}

async function findRepository(ctx: McpToolContext, fullName: string) {
	const [row] = await ctx.db
		.select({
			id: schema.repositories.id,
			fullName: schema.repositories.fullName,
			private: schema.repositories.private,
			enabled: schema.repositories.enabled,
			suspended: sql<boolean>`${schema.githubInstallations.suspendedAt} is not null`.mapWith(
				Boolean
			)
		})
		.from(schema.repositories)
		.innerJoin(
			schema.githubInstallations,
			eq(schema.githubInstallations.id, schema.repositories.installationId)
		)
		.where(
			and(
				eq(schema.githubInstallations.organizationId, ctx.key.organizationId),
				sql`lower(${schema.repositories.fullName}) = ${fullName.toLowerCase()}`
			)
		);
	return row ?? null;
}

async function requireRepository(ctx: McpToolContext, fullName: string) {
	const repository = await findRepository(ctx, fullName);
	if (!repository) throw new ToolError(`No repository named ${fullName} in this organization.`);
	return repository;
}

function publicReview(
	review: typeof schema.reviews.$inferSelect,
	repository: string,
	summaryLimit: number
) {
	return {
		id: review.id,
		repository,
		pullNumber: review.pullNumber,
		headSha: review.headSha,
		status: review.status,
		trigger: review.trigger,
		verdict: review.verdict,
		tier: review.tier,
		tierMeaning: review.tier ? tierMeaning[review.tier as Tier] : null,
		tierReason: review.tierReason,
		summary: clip(review.summary, summaryLimit),
		error: review.error,
		costUsd: review.costUsd,
		createdAt: iso(review.createdAt),
		startedAt: iso(review.startedAt),
		finishedAt: iso(review.finishedAt)
	};
}

function publicFinding(finding: typeof schema.reviewFindings.$inferSelect) {
	return {
		id: finding.id,
		reviewId: finding.reviewId,
		path: finding.path,
		startLine: finding.startLine,
		endLine: finding.endLine,
		severity: finding.severity,
		category: finding.category,
		title: finding.title,
		body: finding.body,
		suggestion: finding.suggestion,
		status: finding.status,
		dropReason: finding.dropReason,
		githubCommentId: finding.githubCommentId,
		createdAt: iso(finding.createdAt)
	};
}

async function whoami(ctx: McpToolContext) {
	requireScope(ctx, 'read');
	return {
		organization: await organization(ctx),
		key: { id: ctx.key.id, name: ctx.key.name, scopes: ctx.key.scopes }
	};
}

async function listRepositories(
	ctx: McpToolContext,
	input: { limit?: number; offset?: number; nameContains?: string }
) {
	requireScope(ctx, 'read');
	const { limit: take, offset: skip } = page(input);
	const where = and(
		eq(schema.githubInstallations.organizationId, ctx.key.organizationId),
		input.nameContains ? contains(schema.repositories.fullName, input.nameContains) : undefined
	);
	const [rows, [count]] = await Promise.all([
		ctx.db
			.select({
				fullName: schema.repositories.fullName,
				private: schema.repositories.private,
				enabled: schema.repositories.enabled,
				suspended: sql<boolean>`${schema.githubInstallations.suspendedAt} is not null`.mapWith(
					Boolean
				)
			})
			.from(schema.repositories)
			.innerJoin(
				schema.githubInstallations,
				eq(schema.githubInstallations.id, schema.repositories.installationId)
			)
			.where(where)
			.orderBy(schema.repositories.fullName)
			.limit(take)
			.offset(skip),
		ctx.db
			.select({ total: sql<number>`count(*)` })
			.from(schema.repositories)
			.innerJoin(
				schema.githubInstallations,
				eq(schema.githubInstallations.id, schema.repositories.installationId)
			)
			.where(where)
	]);
	return {
		repositories: rows.map((row) => ({
			name: row.fullName,
			remote: 'github',
			private: row.private,
			reviewsEnabled: row.enabled && !row.suspended
		})),
		total: Number(count?.total ?? 0),
		returned: rows.length
	};
}

async function listReviews(
	ctx: McpToolContext,
	input: {
		repository?: string;
		pullNumber?: number;
		status?: ReviewStatus;
		limit?: number;
		offset?: number;
	}
) {
	requireScope(ctx, 'read');
	const { limit: take, offset: skip } = page(input);
	const repository = input.repository ? await requireRepository(ctx, input.repository) : null;
	const where = and(
		eq(schema.reviews.organizationId, ctx.key.organizationId),
		repository ? eq(schema.reviews.repositoryId, repository.id) : undefined,
		input.pullNumber ? eq(schema.reviews.pullNumber, input.pullNumber) : undefined,
		input.status ? eq(schema.reviews.status, input.status) : undefined
	);
	const [rows, [count]] = await Promise.all([
		ctx.db
			.select({ review: schema.reviews, repository: schema.repositories.fullName })
			.from(schema.reviews)
			.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
			.where(where)
			.orderBy(desc(schema.reviews.createdAt))
			.limit(take)
			.offset(skip),
		ctx.db
			.select({ total: sql<number>`count(*)` })
			.from(schema.reviews)
			.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
			.where(where)
	]);
	return {
		reviews: rows.map((row) => publicReview(row.review, row.repository, 500)),
		total: Number(count?.total ?? 0),
		returned: rows.length
	};
}

const visibleStatuses = ['posted', 'resolved', 'dismissed'] as const;

async function findingsFor(ctx: McpToolContext, reviewId: string, includeDropped: boolean) {
	const rows = await ctx.db
		.select()
		.from(schema.reviewFindings)
		.where(
			and(
				eq(schema.reviewFindings.reviewId, reviewId),
				includeDropped ? undefined : inArray(schema.reviewFindings.status, [...visibleStatuses])
			)
		)
		.orderBy(schema.reviewFindings.path, schema.reviewFindings.startLine);
	return rows.map(publicFinding);
}

async function getReview(
	ctx: McpToolContext,
	input: { reviewId: string; includeDropped?: boolean }
) {
	requireScope(ctx, 'read');
	const [row] = await ctx.db
		.select({ review: schema.reviews, repository: schema.repositories.fullName })
		.from(schema.reviews)
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(
			and(
				eq(schema.reviews.id, input.reviewId),
				eq(schema.reviews.organizationId, ctx.key.organizationId)
			)
		);
	if (!row) throw new ToolError('No review with that id in this organization.');
	return {
		review: {
			...publicReview(row.review, row.repository, 8000),
			walkthrough: row.review.walkthrough
		},
		findings: await findingsFor(ctx, row.review.id, input.includeDropped ?? false)
	};
}

async function getPullRequest(
	ctx: McpToolContext,
	input: { repository: string; pullNumber: number }
) {
	requireScope(ctx, 'read');
	const repository = await requireRepository(ctx, input.repository);
	const reviews = await ctx.db
		.select()
		.from(schema.reviews)
		.where(
			and(
				eq(schema.reviews.organizationId, ctx.key.organizationId),
				eq(schema.reviews.repositoryId, repository.id),
				eq(schema.reviews.pullNumber, input.pullNumber)
			)
		)
		.orderBy(desc(schema.reviews.createdAt))
		.limit(10);
	const open = await ctx.db
		.select({ finding: schema.reviewFindings })
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(
			and(
				eq(schema.reviews.organizationId, ctx.key.organizationId),
				eq(schema.reviews.repositoryId, repository.id),
				eq(schema.reviews.pullNumber, input.pullNumber),
				eq(schema.reviewFindings.status, 'posted')
			)
		)
		.orderBy(desc(schema.reviewFindings.createdAt))
		.limit(100);
	const latest = reviews[0];
	return {
		repository: repository.fullName,
		pullNumber: input.pullNumber,
		reviewsEnabled: repository.enabled && !repository.suspended,
		latestReview: latest ? publicReview(latest, repository.fullName, 8000) : null,
		openFindings: open.map((row) => publicFinding(row.finding))
	};
}

async function listFindings(
	ctx: McpToolContext,
	input: {
		repository?: string;
		pullNumber?: number;
		status?: (typeof findingStatus.options)[number];
		severity?: 'info' | 'minor' | 'major' | 'critical';
		query?: string;
		limit?: number;
		offset?: number;
	}
) {
	requireScope(ctx, 'read');
	if (input.pullNumber && !input.repository) {
		throw new ToolError('Pass repository together with pullNumber.');
	}
	const { limit: take, offset: skip } = page(input);
	const repository = input.repository ? await requireRepository(ctx, input.repository) : null;
	const status = input.status ?? 'posted';
	const where = and(
		eq(schema.reviews.organizationId, ctx.key.organizationId),
		repository ? eq(schema.reviews.repositoryId, repository.id) : undefined,
		input.pullNumber ? eq(schema.reviews.pullNumber, input.pullNumber) : undefined,
		eq(schema.reviewFindings.status, status),
		input.severity ? eq(schema.reviewFindings.severity, input.severity) : undefined,
		input.query
			? or(
					contains(schema.reviewFindings.title, input.query),
					contains(schema.reviewFindings.body, input.query)
				)
			: undefined
	);
	const rows = await ctx.db
		.select({
			finding: schema.reviewFindings,
			repository: schema.repositories.fullName,
			pullNumber: schema.reviews.pullNumber
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(where)
		.orderBy(desc(schema.reviewFindings.createdAt))
		.limit(take)
		.offset(skip);
	return {
		findings: rows.map((row) => ({
			...publicFinding(row.finding),
			repository: row.repository,
			pullNumber: row.pullNumber
		})),
		returned: rows.length
	};
}

async function searchComments(
	ctx: McpToolContext,
	input: {
		query: string;
		repository?: string;
		includeResolved?: boolean;
		limit?: number;
		offset?: number;
	}
) {
	requireScope(ctx, 'read');
	const statuses = input.includeResolved
		? (['posted', 'resolved', 'dismissed'] as const)
		: (['posted'] as const);
	const repository = input.repository ? await requireRepository(ctx, input.repository) : null;
	const { limit: take, offset: skip } = page(input);
	const rows = await ctx.db
		.select({
			finding: schema.reviewFindings,
			repository: schema.repositories.fullName,
			pullNumber: schema.reviews.pullNumber
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(
			and(
				eq(schema.reviews.organizationId, ctx.key.organizationId),
				repository ? eq(schema.reviews.repositoryId, repository.id) : undefined,
				inArray(schema.reviewFindings.status, [...statuses]),
				or(
					contains(schema.reviewFindings.title, input.query),
					contains(schema.reviewFindings.body, input.query)
				)
			)
		)
		.orderBy(desc(schema.reviewFindings.createdAt))
		.limit(take)
		.offset(skip);
	return {
		findings: rows.map((row) => ({
			...publicFinding(row.finding),
			repository: row.repository,
			pullNumber: row.pullNumber
		})),
		returned: rows.length
	};
}

async function triggerReview(
	ctx: McpToolContext,
	input: { repository: string; pullNumber: number }
) {
	requireScope(ctx, 'write');
	const repository = await requireRepository(ctx, input.repository);
	if (!repository.enabled) throw new ToolError('Reviews are turned off for that repository.');
	if (repository.suspended) throw new ToolError('The GitHub installation is suspended.');

	const [count] = await ctx.db
		.select({ queued: sql<number>`count(*)` })
		.from(schema.reviews)
		.where(
			and(
				eq(schema.reviews.organizationId, ctx.key.organizationId),
				eq(schema.reviews.status, 'queued')
			)
		);
	if (Number(count?.queued ?? 0) >= MAX_QUEUED) {
		throw new ToolError('Too many reviews are already queued. Wait for one to finish.');
	}

	const [active] = await ctx.db
		.select({ id: schema.reviews.id, status: schema.reviews.status })
		.from(schema.reviews)
		.where(
			and(
				eq(schema.reviews.repositoryId, repository.id),
				eq(schema.reviews.pullNumber, input.pullNumber),
				inArray(schema.reviews.status, ['queued', 'running'])
			)
		)
		.limit(1);

	const review = await enqueueReview(ctx.db, ctx.queue, {
		organizationId: ctx.key.organizationId,
		repositoryId: repository.id,
		pullNumber: input.pullNumber,
		headSha: '',
		trigger: 'manual'
	});
	return {
		review: publicReview(review, repository.fullName, 500),
		alreadyInProgress: active?.status === 'running',
		note: 'The review runs on the current head of the pull request and spends model credits.'
	};
}

async function listLearnings(
	ctx: McpToolContext,
	input: { repository?: string; limit?: number; offset?: number }
) {
	requireScope(ctx, 'read');
	const { limit: take, offset: skip } = page(input);
	const repository = input.repository ? await requireRepository(ctx, input.repository) : null;
	const rows = await ctx.db
		.select({
			id: schema.learnings.id,
			body: schema.learnings.body,
			author: schema.learnings.author,
			repository: schema.repositories.fullName,
			createdAt: schema.learnings.createdAt
		})
		.from(schema.learnings)
		.leftJoin(schema.repositories, eq(schema.repositories.id, schema.learnings.repositoryId))
		.where(
			and(
				eq(schema.learnings.organizationId, ctx.key.organizationId),
				repository
					? or(
							isNull(schema.learnings.repositoryId),
							eq(schema.learnings.repositoryId, repository.id)
						)
					: undefined
			)
		)
		.orderBy(desc(schema.learnings.createdAt))
		.limit(take)
		.offset(skip);
	return {
		learnings: rows.map((row) => ({
			id: row.id,
			body: row.body,
			author: row.author,
			repository: row.repository,
			createdAt: iso(row.createdAt)
		})),
		returned: rows.length
	};
}

async function createLearning(ctx: McpToolContext, input: { body: string; repository?: string }) {
	requireScope(ctx, 'write');
	const repository = input.repository ? await requireRepository(ctx, input.repository) : null;
	const [row] = await ctx.db
		.insert(schema.learnings)
		.values({
			organizationId: ctx.key.organizationId,
			repositoryId: repository?.id ?? null,
			body: input.body.trim(),
			author: `mcp:${ctx.key.name}`.slice(0, 80)
		})
		.returning({ id: schema.learnings.id });
	return {
		learning: {
			id: row!.id,
			body: input.body.trim(),
			repository: repository?.fullName ?? null
		}
	};
}

async function deleteLearning(ctx: McpToolContext, input: { learningId: string }) {
	requireScope(ctx, 'write');
	const [row] = await ctx.db
		.delete(schema.learnings)
		.where(
			and(
				eq(schema.learnings.id, input.learningId),
				eq(schema.learnings.organizationId, ctx.key.organizationId)
			)
		)
		.returning({ id: schema.learnings.id });
	if (!row) throw new ToolError('No learning with that id in this organization.');
	return { deleted: true, learningId: row.id };
}
