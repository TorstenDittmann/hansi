import { parseRepoConfig } from '@hans/config';
import {
	checkoutPullRequest,
	diffSince,
	formatFindingComment,
	formatReviewBody,
	runReview,
	type Finding,
	type ReviewEvent
} from '@hans/core';
import { schema, type Database } from '@hans/db';
import {
	completeCheckRun,
	createReview,
	getFileContent,
	getInstallationToken,
	getPullRequest,
	listReviewComments,
	RequestError,
	startCheckRun
} from '@hans/github';
import type { Job, ReviewJobPayload } from '@hans/queue';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
	connectRepository,
	createUsageRecorder,
	loadLearnings,
	loadModels,
	withWorkdir,
	type RepositoryConnection,
	type WorkerContext
} from './shared';

type Review = typeof schema.reviews.$inferSelect;
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

async function executeReview(ctx: WorkerContext, review: Review, log: Logger): Promise<Outcome> {
	const { db, env } = ctx;
	const connection = await connectRepository(ctx, review.repositoryId);
	if (!connection) return { status: 'skipped', summary: 'Repository is no longer installed' };
	const { octokit, ref } = connection;

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

	const models = await loadModels(ctx, review.organizationId);

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

	const usage = await createUsageRecorder(db, {
		organizationId: review.organizationId,
		reviewId: review.id
	});

	try {
		return await withWorkdir(env, async (repoDir) => {
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
			const learnings = await loadLearnings(db, review.organizationId, review.repositoryId);
			record({
				type: 'review.mode',
				data: {
					incremental: !!incrementalFrom,
					from: incrementalFrom ?? pr.baseSha,
					previousFindings: history.findings.length,
					learnings: learnings.length
				}
			});

			const result = await runReview({
				repoDir,
				diff: reviewDiff,
				pullRequestDiff: diff,
				incrementalFrom,
				previousFindings: history.findings,
				learnings,
				pullRequest: pr,
				config,
				models,
				onEvent: record,
				onModelCall: usage.record
			});
			await pendingWrites;
			await db.update(schema.reviews).set(usage.totals).where(eq(schema.reviews.id, review.id));

			if (result.status === 'skipped') {
				await completeCheckRun(octokit, ref, checkRunId, {
					conclusion: 'skipped',
					title: 'Skipped',
					summary: result.reason
				});
				return { status: 'skipped', summary: result.reason } satisfies Outcome;
			}

			const body = formatReviewBody({
				summary: result.summary,
				posted: result.posted.length,
				dropped: result.dropped.length,
				reviewedFiles: result.reviewedFiles.length,
				incrementalFrom,
				detailsUrl
			});
			const commentIds = await postReview(connection, pr, body, result.posted, log);

			const findingRows = [
				...result.posted.map((f, i) => ({
					...f,
					status: 'posted' as const,
					dropReason: null,
					githubCommentId: commentIds[i] ?? null
				})),
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
			return { status: 'completed', summary: result.summary } satisfies Outcome;
		});
	} catch (error) {
		await pendingWrites.catch(() => {});
		await completeCheckRun(octokit, ref, checkRunId, {
			conclusion: 'neutral',
			title: 'Review failed',
			summary: error instanceof Error ? error.message : String(error)
		}).catch((e) => log.warn({ err: e }, 'failed to complete check run'));
		throw error;
	}
}

/**
 * Posts the review and returns the GitHub comment id for each finding (same order), so replies
 * to a finding can be traced back to it.
 */
async function postReview(
	{ octokit, ref }: RepositoryConnection,
	pr: { number: number; headSha: string },
	body: string,
	findings: Finding[],
	log: Logger
): Promise<(number | null)[]> {
	const comments = findings.map((finding) => ({
		path: finding.path,
		line: finding.endLine,
		startLine: finding.startLine,
		body: formatFindingComment(finding)
	}));

	try {
		const review = await createReview(octokit, ref, {
			pullNumber: pr.number,
			commitId: pr.headSha,
			body,
			comments
		});
		if (comments.length === 0) return [];
		const created = await listReviewComments(octokit, ref, pr.number, review.id);
		const used = new Set<number>();
		return comments.map((comment) => {
			const match =
				created.find(
					(c) => !used.has(c.id) && c.path === comment.path && c.body === comment.body
				) ??
				created.find((c) => !used.has(c.id) && c.path === comment.path && c.line === comment.line);
			if (!match) return null;
			used.add(match.id);
			return match.id;
		});
	} catch (error) {
		// GitHub rejects the whole review if one comment position is invalid. Don't lose the
		// findings: fall back to listing them in the review body.
		if (!(error instanceof RequestError && error.status === 422) || comments.length === 0) {
			throw error;
		}
		log.warn({ err: error }, 'inline comments rejected, posting findings in the review body');
		const inline = findings
			.map((f) => `#### \`${f.path}:${f.startLine}-${f.endLine}\`\n\n${formatFindingComment(f)}`)
			.join('\n\n---\n\n');
		await createReview(octokit, ref, {
			pullNumber: pr.number,
			commitId: pr.headSha,
			body: `${body}\n\n${inline}`,
			comments: []
		});
		return findings.map(() => null);
	}
}

/** The last completed review of this PR, and every finding posted on it so far. */
async function loadReviewHistory(db: Database, review: Review) {
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
