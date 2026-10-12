import {
	filesTooLargeFromBody,
	formatReviewBody,
	formatSummaryComment,
	settlementStanding,
	shouldApproveAfterSettlement,
	standingFromOpenFindings,
	STALE_HEAD_NOTE_MARK,
	SUMMARY_MARKER,
	type Finding,
	type SummaryInput
} from '@hans/core';
import { schema, type Database } from '@hans/db';
import { createReview, getMarkedComment, getPullRequest, upsertMarkedComment } from '@hans/github';
import {
	parseRepoConfig,
	severityAtLeast,
	type RepoConfig,
	type Severity,
	type Verdict
} from '@hans/config';
import type { Logger } from 'pino';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { CHANGE_REQUEST_DISMISSAL, staleHeadNote } from './submit-review';
import { reviewDetailsUrlFor, withdrawChangeRequests, type RepositoryConnection } from './shared';

type FindingRow = {
	reviewId: string;
	path: string;
	startLine: number;
	endLine: number;
	severity: string;
	category: string;
	title: string;
	body: string;
	suggestion: string | null;
	status: string;
	dropReason: string | null;
};

/** Fields that live only in the summary comment, not on the review row. */
export type SummaryExtras = {
	latestChanges?: string | null;
	approvalWithheld?: string | null;
	staleHead?: string | null;
	incrementalFrom?: string;
	/** Reviewable files that did not fit in the prompt. Null when the summary does not say so. */
	filesTooLargeForPrompt?: { omitted: number; total: number } | null;
	/** Footer sentence written when a merge did not change the pull request. */
	scope?: string;
};

/**
 * Recovers review-context details from an existing summary body so a settlement rebuild does not
 * drop them. These are not stored on the review row.
 */
export function summaryExtrasFromBody(body: string): SummaryExtras {
	// latestChanges can span lines; it always sits before the verdict table.
	const latestChanges =
		body.match(/\*\*Latest changes:\*\* ([\s\S]*?)\n\n\| Verdict \|/)?.[1] ?? null;
	const noteLines = [...body.matchAll(/> \[!NOTE\]\n> (.+)/g)].map((match) => match[1] ?? '');
	const stalePrefix = `${STALE_HEAD_NOTE_MARK} `;
	const staleLine = noteLines.find((line) => line.startsWith(stalePrefix));
	const approvalWithheld = noteLines.find((line) => !line.startsWith(stalePrefix)) ?? null;
	const incrementalFrom = body.match(/Reviewed the commits since <code>([0-9a-f]+)<\/code>/i)?.[1];
	const scope = body.match(
		/Merged <code>[^<]*<\/code> \(<code>[0-9a-f]+<\/code>\); no changes to this PR's code since <code>[0-9a-f]+<\/code>/
	)?.[0];
	return {
		latestChanges,
		approvalWithheld,
		filesTooLargeForPrompt: filesTooLargeFromBody(body),
		staleHead: staleLine ? staleLine.slice(stalePrefix.length) : null,
		...(incrementalFrom ? { incrementalFrom } : {}),
		...(scope ? { scope } : {})
	};
}

/** Findings the settlement rebuild turns back into the summary comment. Dismissed ones are omitted. */
export async function loadSummaryFindings(
	db: Database,
	input: {
		organizationId: string;
		repositoryId: number;
		pullNumber: number;
		/** Dismissed findings are needed to strip them from the summary prose. */
		includeDismissed?: boolean;
	}
): Promise<FindingRow[]> {
	const { organizationId, repositoryId, pullNumber } = input;
	return db
		.select({
			reviewId: schema.reviewFindings.reviewId,
			path: schema.reviewFindings.path,
			startLine: schema.reviewFindings.startLine,
			endLine: schema.reviewFindings.endLine,
			severity: schema.reviewFindings.severity,
			category: schema.reviewFindings.category,
			title: schema.reviewFindings.title,
			body: schema.reviewFindings.body,
			suggestion: schema.reviewFindings.suggestion,
			status: schema.reviewFindings.status,
			dropReason: schema.reviewFindings.dropReason
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(
			and(
				eq(schema.reviews.repositoryId, repositoryId),
				eq(schema.reviews.pullNumber, pullNumber),
				eq(schema.reviews.status, 'completed'),
				eq(schema.reviews.organizationId, organizationId),
				...(input.includeDismissed ? [] : [ne(schema.reviewFindings.status, 'dismissed')])
			)
		)
		.limit(200);
}

/** Rebuilds the summary comment after a finding is resolved or dismissed in a thread. */
export async function refreshSummaryAfterSettlement(input: {
	db: Database;
	env: { APP_URL: string };
	connection: RepositoryConnection;
	organizationId: string;
	repositoryId: number;
	pullNumber: number;
	/** Findings at or above this severity block the pull request (`reviews.requestChanges`). */
	blockingSeverity: Severity;
	/** Approval rules. Omitted uses the default config. */
	config?: RepoConfig;
	log: Logger;
}): Promise<void> {
	const { db, env, connection, organizationId, repositoryId, pullNumber } = input;
	const { octokit, ref, mention, repository } = connection;
	const config = input.config ?? parseRepoConfig(null).config;

	const [last] = await db
		.select({
			id: schema.reviews.id,
			headSha: schema.reviews.headSha,
			summary: schema.reviews.summary,
			verdict: schema.reviews.verdict,
			walkthrough: schema.reviews.walkthrough
		})
		.from(schema.reviews)
		.where(
			and(
				eq(schema.reviews.repositoryId, repositoryId),
				eq(schema.reviews.pullNumber, pullNumber),
				eq(schema.reviews.status, 'completed'),
				eq(schema.reviews.organizationId, organizationId)
			)
		)
		.orderBy(desc(schema.reviews.finishedAt))
		.limit(1);
	if (!last?.summary || !last.verdict) return;
	const previousSummary = last.summary;
	const previousVerdict = last.verdict;

	const [decisive] = await db
		.select({ verdict: schema.reviews.verdict })
		.from(schema.reviews)
		.where(
			and(
				eq(schema.reviews.repositoryId, repositoryId),
				eq(schema.reviews.pullNumber, pullNumber),
				eq(schema.reviews.status, 'completed'),
				eq(schema.reviews.organizationId, organizationId),
				inArray(schema.reviews.verdict, ['approve', 'request_changes'])
			)
		)
		.orderBy(desc(schema.reviews.finishedAt))
		.limit(1);

	const rows = await loadSummaryFindings(db, {
		organizationId,
		repositoryId,
		pullNumber,
		includeDismissed: true
	});
	const existing = await getMarkedComment(octokit, ref, pullNumber, SUMMARY_MARKER);
	const extras = existing ? summaryExtrasFromBody(existing.body) : {};

	const build = (staleHead: string | null) =>
		summaryAfterSettlement({
			repository: repository.fullName,
			headSha: last.headSha,
			summary: previousSummary,
			verdict: previousVerdict,
			walkthrough: last.walkthrough ?? [],
			latestReviewId: last.id,
			findings: rows,
			detailsUrl: undefined,
			mention,
			...extras,
			staleHead,
			config,
			recompute: true
		});

	// Grade from the findings first. A note that the head moved is applied only after checking
	// the live head, so an outdated note cannot block an approval of the commit under review.
	let summaryInput = build(null);
	if (summaryInput.verdict === 'approve') {
		const pr = await getPullRequest(octokit, ref, pullNumber);
		if (pr.headSha !== last.headSha) {
			summaryInput = build(staleHeadNote(last.headSha, pr.headSha));
		}
	} else if (extras.staleHead) {
		summaryInput = build(extras.staleHead);
	}

	const detailsUrl = await reviewDetailsUrlFor(db, env.APP_URL, organizationId, last.id);
	summaryInput = { ...summaryInput, detailsUrl };

	const summary = await upsertMarkedComment(
		octokit,
		ref,
		pullNumber,
		SUMMARY_MARKER,
		formatSummaryComment(summaryInput)
	);
	if (
		shouldApproveAfterSettlement({
			verdict: summaryInput.verdict,
			lastDecisiveVerdict: decisive?.verdict,
			headMoved: !!summaryInput.staleHead
		})
	) {
		try {
			await createReview(octokit, ref, {
				pullNumber,
				commitId: last.headSha,
				event: 'APPROVE',
				comments: [],
				body: formatReviewBody({
					tier: summaryInput.tier,
					verdict: 'approve',
					blocking: 0,
					comments: 0,
					summaryUrl: summary.url
				})
			});
		} catch (error) {
			input.log.warn({ err: error }, 'could not approve after the finding was settled');
			summaryInput = { ...summaryInput, verdict: 'comment' };
			await upsertMarkedComment(
				octokit,
				ref,
				pullNumber,
				SUMMARY_MARKER,
				formatSummaryComment(summaryInput)
			);
		}
	}
	await db
		.update(schema.reviews)
		.set({
			tier: summaryInput.tier,
			tierReason: summaryInput.tierReason,
			verdict: summaryInput.verdict,
			summary: summaryInput.summary
		})
		.where(eq(schema.reviews.id, last.id));
	// No blocking finding is left: withdraw any change request, including one an earlier review
	// left in place. An approval replaces it too; dismissing finds nothing when there is none.
	const blockingOpen = hasBlockingOpen(rows, input.blockingSeverity);
	if (!blockingOpen && summaryInput.verdict !== 'request_changes') {
		await withdrawChangeRequests(connection, pullNumber, CHANGE_REQUEST_DISMISSAL, input.log);
	}
}

/** Whether a finding at or above the blocking severity is still open on the pull request. */
export function hasBlockingOpen(
	findings: Pick<FindingRow, 'status' | 'severity'>[],
	blockingSeverity: Severity
): boolean {
	return findings.some(
		(f) => f.status === 'posted' && severityAtLeast(f.severity as Severity, blockingSeverity)
	);
}

/**
 * Turns the latest review plus remaining findings into a summary comment body.
 * Dismissed findings are omitted from the lists. With `recompute`, the tier, verdict, and
 * summary prose are rebuilt from the findings that are still posted, so they cannot disagree.
 */
export function summaryAfterSettlement(
	input: {
		repository: string;
		headSha: string;
		summary: string;
		verdict: Verdict;
		walkthrough: { path: string; change: string }[];
		latestReviewId: string;
		findings: FindingRow[];
		detailsUrl?: string;
		mention: string;
		/** Rebuild tier, verdict, and prose from the posted findings. */
		recompute?: boolean;
		config?: RepoConfig;
	} & SummaryExtras
): SummaryInput {
	const toFinding = (row: FindingRow): Finding => ({
		path: row.path,
		startLine: row.startLine,
		endLine: row.endLine,
		severity: row.severity as Severity,
		category: row.category as Finding['category'],
		title: row.title,
		body: row.body,
		...(row.suggestion ? { suggestion: row.suggestion } : {})
	});

	const shortSha = input.headSha.slice(0, 7);
	const posted = input.findings
		.filter((f) => f.status === 'posted' && f.reviewId === input.latestReviewId)
		.map(toFinding);
	const stillOpen = input.findings
		.filter((f) => f.status === 'posted' && f.reviewId !== input.latestReviewId)
		.map((f) => ({
			path: f.path,
			startLine: f.startLine,
			endLine: f.endLine,
			title: f.title,
			body: f.body,
			...(f.suggestion ? { suggestion: f.suggestion } : {}),
			severity: f.severity as Severity
		}));
	const resolved = input.findings
		.filter((f) => f.status === 'resolved' && f.dropReason === `Fixed by ${shortSha}`)
		.map((f) => ({ path: f.path, startLine: f.startLine, title: f.title }));
	const dropped = input.findings
		.filter((f) => f.status === 'dropped' && f.reviewId === input.latestReviewId)
		.map((f) => ({ ...toFinding(f), dropReason: f.dropReason ?? 'Dropped' }));

	const listed = standingFromOpenFindings([...posted, ...stillOpen]);
	const standing = input.recompute
		? settlementStanding({
				summary: input.summary,
				latestReviewId: input.latestReviewId,
				config: input.config ?? parseRepoConfig(null).config,
				approvalWithheld: input.approvalWithheld ?? null,
				headMoved: !!input.staleHead,
				findings: input.findings.map((row) => ({
					reviewId: row.reviewId,
					severity: row.severity as Severity,
					category: row.category,
					title: row.title,
					body: row.body,
					status: row.status
				}))
			})
		: null;

	return {
		repository: input.repository,
		headSha: input.headSha,
		summary: standing?.summary ?? input.summary,
		tier: standing?.tier ?? listed.tier,
		tierReason: standing?.tierReason ?? listed.tierReason,
		verdict: standing?.verdict ?? input.verdict,
		posted,
		resolved,
		stillOpen,
		dropped,
		walkthrough: input.walkthrough,
		latestChanges: input.latestChanges,
		approvalWithheld: standing ? standing.approvalWithheld : input.approvalWithheld,
		filesTooLargeForPrompt: input.filesTooLargeForPrompt,
		staleHead: input.staleHead,
		incrementalFrom: input.incrementalFrom,
		scope: input.scope,
		detailsUrl: input.detailsUrl,
		mention: input.mention
	};
}
