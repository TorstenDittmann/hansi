// Organization-scoped data access for the dashboard. Every query takes `organizationId` and
// filters by it; SQLite has no row-level security, so this module is the tenancy boundary.
import { schema, type ModelRole, type ProviderId } from '@hans/db';
import { encryptSecret, keyHint } from '@hans/llm';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getContext } from './context';

export async function listRepositories(organizationId: string) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.repositories.id,
			fullName: schema.repositories.fullName,
			private: schema.repositories.private,
			enabled: schema.repositories.enabled,
			installationId: schema.repositories.installationId,
			suspended: sql<boolean>`${schema.githubInstallations.suspendedAt} is not null`
		})
		.from(schema.repositories)
		.innerJoin(
			schema.githubInstallations,
			eq(schema.githubInstallations.id, schema.repositories.installationId)
		)
		.where(eq(schema.githubInstallations.organizationId, organizationId))
		.orderBy(schema.repositories.fullName);
}

export async function setRepositoryEnabled(
	organizationId: string,
	repositoryId: number,
	enabled: boolean
) {
	const { db } = await getContext();
	const owned = db
		.select({ id: schema.githubInstallations.id })
		.from(schema.githubInstallations)
		.where(eq(schema.githubInstallations.organizationId, organizationId));
	await db
		.update(schema.repositories)
		.set({ enabled })
		.where(
			and(
				eq(schema.repositories.id, repositoryId),
				sql`${schema.repositories.installationId} in ${owned}`
			)
		);
}

export async function listReviews(organizationId: string, limit = 50) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.reviews.id,
			repository: schema.repositories.fullName,
			pullNumber: schema.reviews.pullNumber,
			status: schema.reviews.status,
			trigger: schema.reviews.trigger,
			verdict: schema.reviews.verdict,
			tier: schema.reviews.tier,
			costUsd: schema.reviews.costUsd,
			createdAt: schema.reviews.createdAt,
			finishedAt: schema.reviews.finishedAt,
			posted: sql<number>`(select count(*) from ${schema.reviewFindings} where ${schema.reviewFindings.reviewId} = ${schema.reviews.id} and ${schema.reviewFindings.status} = 'posted')`
		})
		.from(schema.reviews)
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(eq(schema.reviews.organizationId, organizationId))
		.orderBy(desc(schema.reviews.createdAt))
		.limit(limit);
}

export async function getReview(organizationId: string, reviewId: string) {
	const { db } = await getContext();
	const [review] = await db
		.select({ review: schema.reviews, repository: schema.repositories.fullName })
		.from(schema.reviews)
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(and(eq(schema.reviews.id, reviewId), eq(schema.reviews.organizationId, organizationId)));
	if (!review) return null;

	const [findings, events, calls] = await Promise.all([
		db.select().from(schema.reviewFindings).where(eq(schema.reviewFindings.reviewId, reviewId)),
		db
			.select()
			.from(schema.reviewEvents)
			.where(eq(schema.reviewEvents.reviewId, reviewId))
			.orderBy(schema.reviewEvents.id),
		db
			.select()
			.from(schema.llmCalls)
			.where(eq(schema.llmCalls.reviewId, reviewId))
			.orderBy(schema.llmCalls.createdAt)
	]);
	return { ...review.review, repository: review.repository, findings, events, calls };
}

export async function listCredentials(organizationId: string) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.providerCredentials.id,
			provider: schema.providerCredentials.provider,
			label: schema.providerCredentials.label,
			baseUrl: schema.providerCredentials.baseUrl,
			region: schema.providerCredentials.region,
			keyHint: schema.providerCredentials.keyHint,
			lastVerifiedAt: schema.providerCredentials.lastVerifiedAt
		})
		.from(schema.providerCredentials)
		.where(eq(schema.providerCredentials.organizationId, organizationId))
		.orderBy(schema.providerCredentials.createdAt);
}

export async function addCredential(
	organizationId: string,
	input: { provider: ProviderId; label: string; apiKey: string; baseUrl?: string; region?: string }
) {
	const { db, env } = await getContext();
	const id = crypto.randomUUID();
	await db.insert(schema.providerCredentials).values({
		id,
		organizationId,
		provider: input.provider,
		label: input.label,
		baseUrl: input.baseUrl || null,
		region: input.region || null,
		encryptedKey: await encryptSecret(
			input.apiKey,
			env.HANS_ENCRYPTION_KEY,
			`provider_credentials:${id}`
		),
		keyHint: keyHint(input.apiKey),
		lastVerifiedAt: new Date()
	});
	return id;
}

export async function deleteCredential(organizationId: string, credentialId: string) {
	const { db } = await getContext();
	await db
		.delete(schema.providerCredentials)
		.where(
			and(
				eq(schema.providerCredentials.id, credentialId),
				eq(schema.providerCredentials.organizationId, organizationId)
			)
		);
}

export async function listModelAssignments(organizationId: string) {
	const { db } = await getContext();
	return db
		.select()
		.from(schema.modelAssignments)
		.where(eq(schema.modelAssignments.organizationId, organizationId));
}

export async function setModelAssignment(
	organizationId: string,
	role: ModelRole,
	credentialId: string,
	modelId: string
) {
	const { db } = await getContext();
	const [credential] = await db
		.select({ id: schema.providerCredentials.id })
		.from(schema.providerCredentials)
		.where(
			and(
				eq(schema.providerCredentials.id, credentialId),
				eq(schema.providerCredentials.organizationId, organizationId)
			)
		);
	if (!credential) throw new Error('Unknown credential');

	await db
		.insert(schema.modelAssignments)
		.values({ organizationId, role, credentialId, modelId })
		.onConflictDoUpdate({
			target: [schema.modelAssignments.organizationId, schema.modelAssignments.role],
			set: { credentialId, modelId }
		});
}

export async function clearModelAssignment(organizationId: string, role: ModelRole) {
	const { db } = await getContext();
	await db
		.delete(schema.modelAssignments)
		.where(
			and(
				eq(schema.modelAssignments.organizationId, organizationId),
				eq(schema.modelAssignments.role, role)
			)
		);
}

export async function listLearnings(organizationId: string) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.learnings.id,
			body: schema.learnings.body,
			author: schema.learnings.author,
			sourceUrl: schema.learnings.sourceUrl,
			repository: schema.repositories.fullName,
			createdAt: schema.learnings.createdAt
		})
		.from(schema.learnings)
		.leftJoin(schema.repositories, eq(schema.repositories.id, schema.learnings.repositoryId))
		.where(eq(schema.learnings.organizationId, organizationId))
		.orderBy(desc(schema.learnings.createdAt));
}

export async function addLearning(
	organizationId: string,
	input: { body: string; repositoryId: number | null; author: string | null }
) {
	const { db } = await getContext();
	if (input.repositoryId !== null) {
		const repositories = await listRepositories(organizationId);
		if (!repositories.some((repo) => repo.id === input.repositoryId)) {
			throw new Error('Unknown repository');
		}
	}
	await db.insert(schema.learnings).values({ organizationId, ...input });
}

export async function deleteLearning(organizationId: string, learningId: string) {
	const { db } = await getContext();
	await db
		.delete(schema.learnings)
		.where(
			and(eq(schema.learnings.id, learningId), eq(schema.learnings.organizationId, organizationId))
		);
}

/**
 * What the organization's model calls cost: this and last calendar month (UTC), daily spend for
 * the last 30 days, and a breakdown by model and by repository over the same 30 days.
 */
export async function getCostSummary(organizationId: string, now = new Date()) {
	const { db } = await getContext();
	const { llmCalls, reviews, repositories } = schema;
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
	const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
	const inOrganization = eq(llmCalls.organizationId, organizationId);
	const cost = sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`;
	const day = sql<string>`date(${llmCalls.createdAt} / 1000, 'unixepoch')`;

	const [[month], [lastMonth], [reviewCount], daily, byModel, byRepository] = await Promise.all([
		db
			.select({
				cost,
				inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
				outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
				unpriced: sql<number>`sum(${llmCalls.costUsd} is null)`
			})
			.from(llmCalls)
			.where(and(inOrganization, gte(llmCalls.createdAt, monthStart))),
		db
			.select({ cost })
			.from(llmCalls)
			.where(
				and(
					inOrganization,
					gte(llmCalls.createdAt, lastMonthStart),
					sql`${llmCalls.createdAt} < ${monthStart.getTime()}`
				)
			),
		db
			.select({ count: sql<number>`count(*)` })
			.from(reviews)
			.where(and(eq(reviews.organizationId, organizationId), gte(reviews.createdAt, monthStart))),
		db
			.select({ day, cost })
			.from(llmCalls)
			.where(and(inOrganization, gte(llmCalls.createdAt, since)))
			.groupBy(day),
		db
			.select({
				provider: llmCalls.provider,
				model: llmCalls.model,
				cost,
				calls: sql<number>`count(*)`,
				tokens: sql<number>`sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens})`
			})
			.from(llmCalls)
			.where(and(inOrganization, gte(llmCalls.createdAt, since)))
			.groupBy(llmCalls.provider, llmCalls.model)
			.orderBy(desc(cost)),
		db
			.select({
				repository: repositories.fullName,
				cost,
				reviews: sql<number>`count(distinct ${llmCalls.reviewId})`
			})
			.from(llmCalls)
			.innerJoin(reviews, eq(reviews.id, llmCalls.reviewId))
			.innerJoin(repositories, eq(repositories.id, reviews.repositoryId))
			.where(and(inOrganization, gte(llmCalls.createdAt, since)))
			.groupBy(repositories.fullName)
			.orderBy(desc(cost))
			.limit(8)
	]);

	// One entry per day, including days without calls.
	const costByDay = new Map(daily.map((row) => [row.day, row.cost]));
	const days = Array.from({ length: 30 }, (_, i) => {
		const date = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
		return { day: date, cost: costByDay.get(date) ?? 0 };
	});

	return {
		month: { ...month!, reviews: reviewCount!.count, unpriced: month!.unpriced ?? 0 },
		lastMonthCost: lastMonth!.cost,
		days,
		byModel,
		byRepository
	};
}
