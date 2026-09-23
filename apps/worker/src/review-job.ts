import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRepoConfig, type Env } from '@hans/config';
import {
	checkoutPullRequest,
	diffSince,
	formatFindingComment,
	formatReviewBody,
	runReview,
	type ReviewModel,
	type ReviewEvent
} from '@hans/core';
import { schema, type Database } from '@hans/db';
import {
	completeCheckRun,
	createReview,
	getFileContent,
	getInstallationOctokit,
	getInstallationToken,
	getPullRequest,
	loadGitHubAppCredentials,
	parseFullName,
	RequestError,
	startCheckRun
} from '@hans/github';
import {
	createLanguageModel,
	decryptSecret,
	estimateCost,
	findPrice,
	loadPriceCatalog,
	type ProviderId
} from '@hans/llm';
import type { Job } from '@hans/queue';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Logger } from 'pino';

export interface ReviewJobPayload {
	reviewId: string;
}

export interface WorkerContext {
	db: Database;
	env: Env;
	logger: Logger;
}

type Outcome = { status: 'completed' | 'skipped'; summary: string };

export async function handleReviewJob(ctx: WorkerContext, job: Job<ReviewJobPayload>) {
	const { db, logger } = ctx;
	const { reviewId } = job.payload;
	const log = logger.child({ reviewId, jobId: job.id });

	const [review] = await db.select().from(schema.reviews).where(eq(schema.reviews.id, reviewId));
	if (!review || review.status === 'superseded' || review.status === 'completed') {
		log.info({ status: review?.status }, 'review no longer pending, skipping');
		return;
	}

	const setReview = (values: Partial<typeof schema.reviews.$inferInsert>) =>
		db.update(schema.reviews).set(values).where(eq(schema.reviews.id, reviewId));

	try {
		const outcome = await executeReview(ctx, review, log);
		await setReview({ ...outcome, finishedAt: new Date() });
		log.info({ status: outcome.status }, 'review finished');
	} catch (error) {
		const final = job.attempts >= job.maxAttempts;
		const message = error instanceof Error ? error.message : String(error);
		await setReview(
			final
				? { status: 'failed', error: message, finishedAt: new Date() }
				: { status: 'queued', error: message }
		);
		throw error;
	}
}

async function executeReview(
	ctx: WorkerContext,
	review: typeof schema.reviews.$inferSelect,
	log: Logger
): Promise<Outcome> {
	const { db, env } = ctx;

	const [row] = await db
		.select({ repo: schema.repositories, installation: schema.githubInstallations })
		.from(schema.repositories)
		.innerJoin(
			schema.githubInstallations,
			eq(schema.githubInstallations.id, schema.repositories.installationId)
		)
		.where(eq(schema.repositories.id, review.repositoryId));
	if (!row) return { status: 'skipped', summary: 'Repository is no longer installed' };

	const credentials = await loadGitHubAppCredentials(db, env);
	if (!credentials) throw new Error('GitHub App is not configured');

	const octokit = await getInstallationOctokit(credentials, row.installation.id);
	const ref = parseFullName(row.repo.fullName);
	const pr = await getPullRequest(octokit, ref, review.pullNumber);
	if (pr.state !== 'open') return { status: 'skipped', summary: 'Pull request is closed' };

	const { config, ...configResult } = parseRepoConfig(
		await getFileContent(octokit, ref, '.hans.yml', pr.headSha)
	);
	const isAutomatic = review.trigger === 'opened' || review.trigger === 'synchronize';
	const skipReason = !config.reviews.enabled
		? 'Reviews are disabled in .hans.yml'
		: isAutomatic && !config.reviews.auto
			? 'Automatic reviews are disabled in .hans.yml'
			: isAutomatic && pr.draft && !config.reviews.drafts
				? 'Draft pull request'
				: isAutomatic &&
					  config.reviews.base_branches.length > 0 &&
					  !config.reviews.base_branches.includes(pr.baseRef)
					? `Base branch ${pr.baseRef} is not configured for reviews`
					: null;
	if (skipReason) return { status: 'skipped', summary: skipReason };

	const models = await loadModels(db, env, review.organizationId);

	await db
		.update(schema.reviews)
		.set({ status: 'running', headSha: pr.headSha, startedAt: new Date(), error: null })
		.where(eq(schema.reviews.id, review.id));

	const detailsUrl = `${env.APP_URL.replace(/\/+$/, '')}/app/reviews/${review.id}`;
	const checkRunId = await startCheckRun(octokit, ref, {
		headSha: pr.headSha,
		name: 'hans',
		detailsUrl
	});

	// Events are written sequentially, off the model's critical path.
	let pendingWrites: Promise<unknown> = Promise.resolve();
	const record = (event: ReviewEvent) => {
		pendingWrites = pendingWrites.then(() =>
			db.insert(schema.reviewEvents).values({ reviewId: review.id, ...event })
		);
	};
	if (!configResult.ok) record({ type: 'config.invalid', data: { errors: configResult.errors } });

	const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
	const catalog = await loadPriceCatalog();
	const workRoot = env.WORKER_WORKDIR ?? join(tmpdir(), 'hans');
	await mkdir(workRoot, { recursive: true });
	const repoDir = await mkdtemp(join(workRoot, 'review-'));

	try {
		const token = await getInstallationToken(octokit);
		const diff = await checkoutPullRequest({
			dir: repoDir,
			cloneUrl: pr.cloneUrl,
			token,
			pullNumber: pr.number,
			baseSha: pr.baseSha,
			headSha: pr.headSha
		});

		// On a push, review only the new commits when the last reviewed head is still an ancestor.
		const history = await loadReviewHistory(db, review);
		let reviewDiff = diff;
		let incrementalFrom: string | undefined;
		if (review.trigger === 'synchronize' && history.lastHeadSha) {
			const since = await diffSince({
				dir: repoDir,
				fromSha: history.lastHeadSha,
				headSha: pr.headSha,
				token
			});
			if (since !== null) {
				reviewDiff = since;
				incrementalFrom = history.lastHeadSha;
			}
		}
		record({
			type: 'review.mode',
			data: {
				incremental: !!incrementalFrom,
				from: incrementalFrom ?? pr.baseSha,
				previousFindings: history.findings.length
			}
		});

		const result = await runReview({
			repoDir,
			diff: reviewDiff,
			pullRequestDiff: diff,
			incrementalFrom,
			previousFindings: history.findings,
			pullRequest: pr,
			config,
			models,
			onEvent: record,
			onModelCall: async (call) => {
				const cost = estimateCost(
					findPrice(catalog, call.provider as ProviderId, call.modelId),
					call.usage
				);
				totals.inputTokens += call.usage.inputTokens ?? 0;
				totals.outputTokens += call.usage.outputTokens ?? 0;
				totals.costUsd += cost ?? 0;
				await db.insert(schema.llmCalls).values({
					reviewId: review.id,
					organizationId: review.organizationId,
					role: call.role,
					provider: call.provider,
					model: call.modelId,
					inputTokens: call.usage.inputTokens ?? 0,
					outputTokens: call.usage.outputTokens ?? 0,
					cachedInputTokens: call.usage.inputTokenDetails?.cacheReadTokens ?? 0,
					costUsd: cost,
					durationMs: call.durationMs
				});
			}
		});
		await pendingWrites;
		await db.update(schema.reviews).set(totals).where(eq(schema.reviews.id, review.id));

		if (result.status === 'skipped') {
			await completeCheckRun(octokit, ref, checkRunId, {
				conclusion: 'skipped',
				title: 'Skipped',
				summary: result.reason
			});
			return { status: 'skipped', summary: result.reason };
		}

		const body = formatReviewBody({
			summary: result.summary,
			posted: result.posted.length,
			dropped: result.dropped.length,
			reviewedFiles: result.reviewedFiles.length,
			incrementalFrom,
			detailsUrl
		});
		const comments = result.posted.map((finding) => ({
			path: finding.path,
			line: finding.endLine,
			startLine: finding.startLine,
			body: formatFindingComment(finding)
		}));

		try {
			await createReview(octokit, ref, {
				pullNumber: pr.number,
				commitId: pr.headSha,
				body,
				comments
			});
		} catch (error) {
			// GitHub rejects the whole review if one comment position is invalid. Don't lose the
			// findings: fall back to listing them in the review body.
			if (!(error instanceof RequestError && error.status === 422) || comments.length === 0)
				throw error;
			log.warn({ err: error }, 'inline comments rejected, posting findings in the review body');
			const inline = result.posted
				.map((f) => `#### \`${f.path}:${f.startLine}-${f.endLine}\`\n\n${formatFindingComment(f)}`)
				.join('\n\n---\n\n');
			await createReview(octokit, ref, {
				pullNumber: pr.number,
				commitId: pr.headSha,
				body: `${body}\n\n${inline}`,
				comments: []
			});
		}

		const findingRows = [
			...result.posted.map((f) => ({ ...f, status: 'posted' as const, dropReason: null })),
			...result.dropped.map((f) => ({ ...f, status: 'dropped' as const }))
		].map(({ suggestion, ...f }) => ({
			...f,
			suggestion: suggestion ?? null,
			reviewId: review.id
		}));
		if (findingRows.length) await db.insert(schema.reviewFindings).values(findingRows);

		await completeCheckRun(octokit, ref, checkRunId, {
			conclusion: result.posted.length ? 'neutral' : 'success',
			title: result.posted.length
				? `${result.posted.length} comment${result.posted.length === 1 ? '' : 's'}`
				: 'No issues found',
			summary: result.summary
		});
		return { status: 'completed', summary: result.summary };
	} catch (error) {
		await pendingWrites.catch(() => {});
		await completeCheckRun(octokit, ref, checkRunId, {
			conclusion: 'neutral',
			title: 'Review failed',
			summary: error instanceof Error ? error.message : String(error)
		}).catch((e) => log.warn({ err: e }, 'failed to complete check run'));
		throw error;
	} finally {
		await rm(repoDir, { recursive: true, force: true });
	}
}

/** The last completed review of this PR, and every finding posted on it so far. */
async function loadReviewHistory(db: Database, review: typeof schema.reviews.$inferSelect) {
	const samePullRequest = and(
		eq(schema.reviews.repositoryId, review.repositoryId),
		eq(schema.reviews.pullNumber, review.pullNumber),
		eq(schema.reviews.status, 'completed'),
		ne(schema.reviews.id, review.id)
	);
	const [last] = await db
		.select({ headSha: schema.reviews.headSha })
		.from(schema.reviews)
		.where(samePullRequest)
		.orderBy(desc(schema.reviews.finishedAt))
		.limit(1);
	const findings = await db
		.select({
			path: schema.reviewFindings.path,
			startLine: schema.reviewFindings.startLine,
			endLine: schema.reviewFindings.endLine,
			category: schema.reviewFindings.category,
			title: schema.reviewFindings.title
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(and(samePullRequest, eq(schema.reviewFindings.status, 'posted')))
		.limit(200);
	return { lastHeadSha: last?.headSha || undefined, findings };
}

async function loadModels(db: Database, env: Env, organizationId: string) {
	const assignments = await db
		.select({ assignment: schema.modelAssignments, credential: schema.providerCredentials })
		.from(schema.modelAssignments)
		.innerJoin(
			schema.providerCredentials,
			eq(schema.providerCredentials.id, schema.modelAssignments.credentialId)
		)
		.where(
			and(
				eq(schema.modelAssignments.organizationId, organizationId),
				eq(schema.providerCredentials.organizationId, organizationId)
			)
		);

	const resolve = async (role: 'review' | 'verify'): Promise<ReviewModel | undefined> => {
		const entry = assignments.find((a) => a.assignment.role === role);
		if (!entry) return undefined;
		const apiKey = await decryptSecret(
			entry.credential.encryptedKey,
			env.HANS_ENCRYPTION_KEY,
			`provider_credentials:${entry.credential.id}`
		);
		return {
			model: createLanguageModel(
				{ provider: entry.credential.provider, apiKey, baseUrl: entry.credential.baseUrl },
				entry.assignment.modelId
			),
			provider: entry.credential.provider,
			modelId: entry.assignment.modelId
		};
	};

	const review = await resolve('review');
	if (!review)
		throw new Error('No review model configured. Add a provider key in Settings → Models.');
	return { review, verify: await resolve('verify') };
}
