import {
	blockingSeverity,
	parseRepoConfig,
	REPO_CONFIG_FILE,
	severityAtLeast,
	type RepoConfig,
	type Severity
} from '@hans/config';
import {
	checkoutPullRequest,
	diffSince,
	formatFindingComment,
	formatReviewBody,
	formatSummaryComment,
	runReview,
	SUMMARY_MARKER,
	tierMeaning,
	type Finding,
	type OpenFinding,
	type ReviewEvent as TraceEvent,
	type Verdict
} from '@hans/core';
import { schema, type Database } from '@hans/db';
import {
	completeCheckRun,
	createReview,
	getFileContent,
	getInstallationToken,
	getPullRequest,
	isTrustedAuthor,
	listReviewComments,
	RequestError,
	resolveReviewThreads,
	startCheckRun,
	upsertMarkedComment,
	type ReviewEvent
} from '@hans/github';
import type { Job, ReviewJobPayload } from '@hans/queue';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
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
type Outcome = Pick<
	typeof schema.reviews.$inferInsert,
	'status' | 'summary' | 'verdict' | 'tier' | 'tierReason' | 'walkthrough'
>;

const reviewEvents = {
	approve: 'APPROVE',
	request_changes: 'REQUEST_CHANGES',
	comment: 'COMMENT'
} as const satisfies Record<Verdict, ReviewEvent>;

/** The check run follows the verdict, so teams can require it for merging. */
const checkConclusions = {
	approve: 'success',
	request_changes: 'failure',
	comment: 'neutral'
} as const;

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

	// Configuration comes from the base branch: a pull request must not rewrite its own review
	// rules. Changes to .hansi.json apply once they are merged.
	const { config, ...configResult } = parseRepoConfig(
		await getFileContent(octokit, ref, REPO_CONFIG_FILE, pr.baseSha)
	);
	const isAutomatic = review.trigger === 'opened' || review.trigger === 'synchronize';
	const skipReason = !config.reviews.enabled
		? 'Reviews are disabled in .hansi.json'
		: isAutomatic && !config.reviews.auto
			? 'Automatic reviews are disabled in .hansi.json'
			: isAutomatic && pr.draft && !config.reviews.drafts
				? 'Draft pull request'
				: isAutomatic &&
					  config.reviews.baseBranches.length > 0 &&
					  !config.reviews.baseBranches.includes(pr.baseRef)
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
		name: 'Hansi',
		detailsUrl
	});

	// Events are written sequentially, off the model's critical path.
	let pendingWrites: Promise<unknown> = Promise.resolve();
	const record = (event: TraceEvent) => {
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
					openFindings: history.open.length,
					learnings: learnings.length
				}
			});

			const result = await runReview({
				repoDir,
				diff: reviewDiff,
				pullRequestDiff: diff,
				incrementalFrom,
				previousFindings: history.findings,
				openFindings: history.open,
				previousSummary: history.previousSummary,
				learnings,
				trustedSource: { ref: pr.baseSha, token },
				withholdApproval: await approvalRestriction(connection, pr, config),
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

			// Earlier findings the new code fixes are resolved before the verdict is posted.
			if (result.resolved.length) {
				const fixed = await db
					.update(schema.reviewFindings)
					.set({ status: 'resolved', dropReason: `Fixed by ${pr.headSha.slice(0, 7)}` })
					.where(inArray(schema.reviewFindings.id, result.resolved))
					.returning({ commentId: schema.reviewFindings.githubCommentId });
				// Close their threads on GitHub too. Quietly: the summary lists what was fixed.
				await resolveReviewThreads(
					octokit,
					ref,
					pr.number,
					fixed.flatMap((f) => (f.commentId ? [f.commentId] : []))
				).catch((error) => log.warn({ err: error }, 'could not resolve fixed threads'));
			}

			// One summary comment per PR, edited in place on every review.
			const threshold = blockingSeverity(config);
			const summary = await upsertMarkedComment(
				octokit,
				ref,
				pr.number,
				SUMMARY_MARKER,
				formatSummaryComment({
					repository: connection.repository.fullName,
					headSha: pr.headSha,
					summary: result.summary,
					tier: result.tier,
					tierReason: result.tierReason,
					verdict: result.verdict,
					posted: result.posted,
					resolved: history.open.filter((f) => result.resolved.includes(f.id)),
					stillOpen: history.open.filter(
						(f) => !result.resolved.includes(f.id) && severityAtLeast(f.severity, threshold)
					),
					dropped: result.dropped,
					walkthrough: result.walkthrough,
					latestChanges: result.latestChanges,
					approvalWithheld: result.approvalWithheld,
					incrementalFrom,
					detailsUrl,
					mention: connection.mention
				})
			);

			// A GitHub review is only submitted when it adds something: inline comments, or a change
			// of Hansi's approve / request-changes state. Otherwise the summary update is enough.
			const stateChanged =
				result.verdict !== 'comment' && result.verdict !== history.lastDecisiveVerdict;
			const commentIds =
				result.posted.length || stateChanged
					? await postReview(
							connection,
							pr,
							{
								body: formatReviewBody({
									tier: result.tier,
									verdict: result.verdict,
									blocking: result.posted.filter((f) => severityAtLeast(f.severity, threshold))
										.length,
									summaryUrl: summary.url
								}),
								event: reviewEvents[result.verdict]
							},
							result.posted,
							log
						)
					: [];
			record({
				type: 'review.posted',
				data: { summaryUrl: summary.url, submittedReview: result.posted.length > 0 || stateChanged }
			});

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
				conclusion: checkConclusions[result.verdict],
				title: `Tier ${result.tier}: ${tierMeaning[result.tier]}`,
				summary: [result.tierReason, result.summary].filter(Boolean).join('\n\n')
			});
			return {
				status: 'completed',
				summary: result.summary,
				verdict: result.verdict,
				tier: result.tier,
				tierReason: result.tierReason,
				walkthrough: result.walkthrough
			} satisfies Outcome;
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
 * Why Hansi may not approve this PR, if anything. Content from people without write access could
 * try to talk the model into approving, so their PRs get findings but never an approval.
 */
async function approvalRestriction(
	{ octokit, ref }: RepositoryConnection,
	pr: { author: string; authorAssociation: string },
	config: RepoConfig
): Promise<string | undefined> {
	if (config.reviews.approveOutsideContributors) return undefined;
	if (await isTrustedAuthor(octokit, ref, pr)) return undefined;
	return `@${pr.author} does not have write access to this repository, so Hansi does not approve automatically. A maintainer can review and approve.`;
}

/**
 * Posts the review and returns the GitHub comment id for each finding (same order), so replies
 * to a finding can be traced back to it.
 */
async function postReview(
	{ octokit, ref }: RepositoryConnection,
	pr: { number: number; headSha: string },
	review: { body: string; event: ReviewEvent },
	findings: Finding[],
	log: Logger
): Promise<(number | null)[]> {
	const { body, event } = review;
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
			comments,
			event
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
			comments: [],
			event
		});
		return findings.map(() => null);
	}
}

/**
 * The last completed review of this PR, the findings not to repeat (posted and dismissed), and
 * the findings still open.
 */
async function loadReviewHistory(db: Database, review: Review) {
	const samePullRequest = and(
		eq(schema.reviews.repositoryId, review.repositoryId),
		eq(schema.reviews.pullNumber, review.pullNumber),
		eq(schema.reviews.status, 'completed'),
		ne(schema.reviews.id, review.id)
	);
	const [last] = await db
		.select({
			headSha: schema.reviews.headSha,
			summary: schema.reviews.summary,
			walkthrough: schema.reviews.walkthrough
		})
		.from(schema.reviews)
		.where(samePullRequest)
		.orderBy(desc(schema.reviews.finishedAt))
		.limit(1);
	// Hansi's current approve / request-changes state on GitHub is its latest such review.
	const [decisive] = await db
		.select({ verdict: schema.reviews.verdict })
		.from(schema.reviews)
		.where(and(samePullRequest, inArray(schema.reviews.verdict, ['approve', 'request_changes'])))
		.orderBy(desc(schema.reviews.finishedAt))
		.limit(1);
	const rows = await db
		.select({
			id: schema.reviewFindings.id,
			path: schema.reviewFindings.path,
			startLine: schema.reviewFindings.startLine,
			endLine: schema.reviewFindings.endLine,
			severity: schema.reviewFindings.severity,
			category: schema.reviewFindings.category,
			title: schema.reviewFindings.title,
			body: schema.reviewFindings.body,
			status: schema.reviewFindings.status
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(and(samePullRequest, ne(schema.reviewFindings.status, 'dropped')))
		.limit(200);
	const open: OpenFinding[] = rows
		.filter((f) => f.status === 'posted')
		.map((f) => ({ ...f, severity: f.severity as Severity }));
	// Resolved findings may be reported again if the problem comes back; dismissed ones may not.
	const findings = rows.filter((f) => f.status !== 'resolved');
	return {
		lastHeadSha: last?.headSha || undefined,
		previousSummary:
			last?.summary && last.walkthrough
				? { summary: last.summary, walkthrough: last.walkthrough }
				: undefined,
		lastDecisiveVerdict: decisive?.verdict ?? undefined,
		findings,
		open
	};
}
