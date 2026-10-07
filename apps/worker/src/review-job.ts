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
	createIssueComment,
	createReview,
	getFailedChecks,
	getFileContent,
	getInstallationToken,
	getLinkedIssues,
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
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { REVIEW_FAILURE_SUMMARY } from './public-failure';
import {
	connectRepository,
	createUsageRecorder,
	loadLearnings,
	loadModels,
	reviewDetailsUrlFor,
	withWorkdir,
	type RepositoryConnection,
	type WorkerContext
} from './shared';
import {
	mentionWantsSameHeadReply,
	otherPullReviews,
	sameHeadCoalesce,
	sameHeadSkipSummary
} from './same-head';
import { shouldSubmitReview, submissionForCurrentHead } from './submit-review';

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
		if (outcome.status === 'completed') await trackReviewCompleted(ctx, review);
	} catch (error) {
		const final = job.attempts >= job.maxAttempts;
		const message = error instanceof Error ? error.message : String(error);
		await setReview(
			final
				? { status: 'failed', error: message, finishedAt: new Date() }
				: { status: 'queued', error: message }
		);
		if (final) {
			ctx.analytics.capture({
				distinctId: `organization:${review.organizationId}`,
				event: 'review failed',
				organizationId: review.organizationId,
				properties: { trigger: review.trigger }
			});
		}
		throw error;
	}
}

/** Reports a finished review: its outcome and cost, never code or repository names. */
async function trackReviewCompleted({ db, analytics }: WorkerContext, review: Review) {
	const [row] = await db
		.select({
			verdict: schema.reviews.verdict,
			tier: schema.reviews.tier,
			costUsd: schema.reviews.costUsd,
			inputTokens: schema.reviews.inputTokens,
			outputTokens: schema.reviews.outputTokens,
			comments: sql<number>`(select count(*) from ${schema.reviewFindings} where ${schema.reviewFindings.reviewId} = ${schema.reviews.id} and ${schema.reviewFindings.status} = 'posted')`
		})
		.from(schema.reviews)
		.where(eq(schema.reviews.id, review.id));
	if (!row) return;
	analytics.capture({
		distinctId: `organization:${review.organizationId}`,
		event: 'review completed',
		organizationId: review.organizationId,
		properties: { trigger: review.trigger, ...row }
	});
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

	// A follow-up trigger (a mention while this commit is in review, or another event after it
	// finished) would otherwise run next and submit again. The queue only replaces queued jobs.
	// Skip when this commit is already covered. A new commit has a different head and still runs.
	const covered = sameHeadCoalesce(pr.headSha, await otherPullReviews(db, review));
	if (covered) {
		const summary = sameHeadSkipSummary(covered, pr.headSha);
		log.info({ reason: covered, headSha: pr.headSha }, 'commit already reviewed, skipping');
		if (mentionWantsSameHeadReply(review.trigger)) {
			await createIssueComment(octokit, ref, pr.number, summary).catch((error) =>
				log.warn({ err: error }, 'could not reply that this commit is already reviewed')
			);
		}
		await db
			.update(schema.reviews)
			.set({ headSha: pr.headSha })
			.where(eq(schema.reviews.id, review.id));
		return { status: 'skipped', summary };
	}

	const models = await loadModels(ctx, review.organizationId);

	await db
		.update(schema.reviews)
		.set({ status: 'running', headSha: pr.headSha, startedAt: new Date(), error: null })
		.where(eq(schema.reviews.id, review.id));

	const detailsUrl = await reviewDetailsUrlFor(db, env.APP_URL, review.organizationId, review.id);
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

	const usage = await createUsageRecorder(ctx, {
		organizationId: review.organizationId,
		reviewId: review.id,
		traceId: review.id
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
			const { linkedIssues, failedChecks } = await loadPullRequestContext(connection, pr, log);
			record({
				type: 'review.mode',
				data: {
					incremental: !!incrementalFrom,
					from: incrementalFrom ?? pr.baseSha,
					previousFindings: history.findings.length,
					openFindings: history.open.length,
					learnings: learnings.length,
					linkedIssues: linkedIssues.map((i) => i.number),
					failedChecks: failedChecks.map((c) => c.name)
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
				linkedIssues,
				failedChecks,
				config,
				models,
				onEvent: record,
				onModelCall: usage.record,
				onModelError: usage.recordError
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
			const stillOpen = history.open.filter((f) => !result.resolved.includes(f.id));
			// Submit a GitHub review when there are inline comments, the approve/request-changes
			// state changes, the pull request reaches Tier S, or someone explicitly asked for a
			// re-review. A clean Tier S used to only edit the summary, so the timeline never
			// showed the review the earlier grades left.
			const plannedSubmit = shouldSubmitReview({
				posted: result.posted.length,
				verdict: result.verdict,
				tier: result.tier,
				previousTier: history.previousTier,
				lastDecisiveVerdict: history.lastDecisiveVerdict,
				trigger: review.trigger
			});
			// The model ran against `pr.headSha`. Re-read the head before publishing so an
			// approval cannot land on a commit the author has already replaced.
			const decide = (currentHeadSha: string) =>
				submissionForCurrentHead({
					reviewedSha: pr.headSha,
					currentHeadSha,
					verdict: result.verdict,
					posted: result.posted.length,
					shouldSubmit: plannedSubmit
				});
			const summaryBody = (decision: ReturnType<typeof decide>) =>
				formatSummaryComment({
					repository: connection.repository.fullName,
					// Line links stay on the reviewed commit. The new head may have moved them.
					headSha: pr.headSha,
					summary: result.summary,
					tier: result.tier,
					tierReason: result.tierReason,
					verdict: decision.verdict,
					posted: result.posted,
					resolved: history.open.filter((f) => result.resolved.includes(f.id)),
					// Every open finding, including minors: the grade may rest on them.
					stillOpen,
					dropped: result.dropped,
					walkthrough: result.walkthrough,
					latestChanges: result.latestChanges,
					approvalWithheld: result.approvalWithheld,
					staleHead: decision.note,
					incrementalFrom,
					detailsUrl,
					mention: connection.mention
				});

			let submission = decide((await getPullRequest(octokit, ref, pr.number)).headSha);
			let summary = await upsertMarkedComment(
				octokit,
				ref,
				pr.number,
				SUMMARY_MARKER,
				summaryBody(submission)
			);
			// Confirm again immediately before a decisive review. The summary write is the only
			// gap after the first read; a move there downgrades the event instead of approving.
			if (submission.submit && submission.verdict !== 'comment') {
				const confirmed = decide((await getPullRequest(octokit, ref, pr.number)).headSha);
				if (confirmed.headMoved) {
					submission = confirmed;
					summary = await upsertMarkedComment(
						octokit,
						ref,
						pr.number,
						SUMMARY_MARKER,
						summaryBody(submission)
					);
				}
			}
			if (submission.headMoved) {
				log.info(
					{ reviewedSha: pr.headSha, submit: submission.submit },
					'pull request head moved before submit'
				);
			}

			const commentIds = submission.submit
				? await postReview(
						connection,
						pr,
						{
							body: formatReviewBody({
								tier: result.tier,
								verdict: submission.verdict,
								blocking: result.posted.filter((f) => severityAtLeast(f.severity, threshold))
									.length,
								comments: result.posted.length,
								summaryUrl: summary.url
							}),
							event: reviewEvents[submission.verdict]
						},
						result.posted,
						log
					)
				: [];
			record({
				type: 'review.posted',
				data: {
					summaryUrl: summary.url,
					submittedReview: submission.submit,
					headMoved: submission.headMoved
				}
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
				conclusion: checkConclusions[submission.verdict],
				title: submission.headMoved
					? 'Newer commits will be reviewed'
					: `Tier ${result.tier}: ${tierMeaning[result.tier]}`,
				summary: [submission.note, result.tierReason, result.summary].filter(Boolean).join('\n\n')
			});
			return {
				status: 'completed',
				summary: result.summary,
				verdict: submission.verdict,
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
			summary: REVIEW_FAILURE_SUMMARY
		}).catch((e) => log.warn({ err: e }, 'failed to complete check run'));
		throw error;
	}
}

/**
 * What the pull request is meant to do and what CI already knows about it. Both are extras: if
 * GitHub fails to return them, the review goes ahead without.
 */
async function loadPullRequestContext(
	{ octokit, ref, appId }: RepositoryConnection,
	pr: { number: number; headSha: string },
	log: Logger
) {
	const [linkedIssues, failedChecks] = await Promise.all([
		getLinkedIssues(octokit, ref, pr.number).catch((error) => {
			log.warn({ err: error }, 'could not load linked issues');
			return [];
		}),
		getFailedChecks(octokit, ref, pr.headSha, appId).catch((error) => {
			log.warn({ err: error }, 'could not load failed checks');
			return [];
		})
	]);
	return { linkedIssues, failedChecks };
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
			walkthrough: schema.reviews.walkthrough,
			tier: schema.reviews.tier
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
			suggestion: schema.reviewFindings.suggestion,
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
		previousTier: last?.tier,
		previousSummary:
			last?.summary && last.walkthrough
				? { summary: last.summary, walkthrough: last.walkthrough }
				: undefined,
		lastDecisiveVerdict: decisive?.verdict ?? undefined,
		findings,
		open
	};
}
