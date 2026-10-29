import {
	absolutizeLinks,
	decideVerdict,
	filesTooLargeFromBody,
	formatReviewBody,
	formatSummaryComment,
	standingFromOpenFindings,
	STALE_HEAD_NOTE_MARK,
	SUMMARY_MARKER,
	tierMeaning,
	type Finding,
	type SummaryInput,
	type Tier
} from '@hans/core';
import { schema, type Database } from '@hans/db';
import {
	completeCheckRun,
	createReview,
	findOwnCheckRun,
	getMarkedComment,
	getPullRequest,
	isTrustedAuthor,
	upsertMarkedComment
} from '@hans/github';
import {
	blockingSeverity,
	severityAtLeast,
	type RepoConfig,
	type Severity,
	type Verdict
} from '@hans/config';
import type { Logger } from 'pino';
import { and, desc, eq, ne } from 'drizzle-orm';
import { statusBlockOf, withStatusBlock } from './progress';
import { CHANGE_REQUEST_DISMISSAL, shouldApproveAfterSettlement } from './submit-review';
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
	input: { organizationId: string; repositoryId: number; pullNumber: number }
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
				ne(schema.reviewFindings.status, 'dismissed')
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
	config: RepoConfig;
	log: Logger;
}): Promise<void> {
	const { db, env, connection, organizationId, repositoryId, pullNumber, config, log } = input;
	const { octokit, ref, mention, repository } = connection;

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
	const lastSummary = last.summary;

	const rows = await loadSummaryFindings(db, { organizationId, repositoryId, pullNumber });
	const blockingOpen = hasBlockingOpen(rows, blockingSeverity(config));
	const lastVerdict = last.verdict as Verdict;
	// A change request stands while a blocking finding is open; after that the latest verdict
	// becomes a comment, or an approval when the latest review would have approved without the
	// settled findings.
	const settledVerdict: Verdict =
		lastVerdict === 'request_changes' && !blockingOpen ? 'comment' : lastVerdict;

	const existing = await getMarkedComment(octokit, ref, pullNumber, SUMMARY_MARKER);
	const extras = existing ? summaryExtrasFromBody(existing.body) : {};
	const approve = await approvesAfterSettlement(connection, {
		pullNumber,
		reviewedSha: last.headSha,
		lastVerdict,
		open: rows
			.filter((f) => f.status === 'posted')
			.map((f) => ({ ...f, severity: f.severity as Severity })),
		diffTruncated: !!extras.filesTooLargeForPrompt,
		config,
		log
	});

	const detailsUrl = await reviewDetailsUrlFor(db, env.APP_URL, organizationId, last.id);
	const writeSummary = async (verdict: Verdict) => {
		const summaryInput = summaryAfterSettlement({
			repository: repository.fullName,
			headSha: last.headSha,
			summary: lastSummary,
			verdict,
			walkthrough: last.walkthrough ?? [],
			latestReviewId: last.id,
			findings: rows,
			detailsUrl,
			mention,
			...extras,
			// The note explained a withheld approval. One that is now given has no reason left.
			...(verdict === 'approve' ? { approvalWithheld: null } : {})
		});
		// A review running right now keeps its status line above the rebuilt summary.
		const comment = await upsertMarkedComment(
			octokit,
			ref,
			pullNumber,
			SUMMARY_MARKER,
			withStatusBlock(formatSummaryComment(summaryInput), existing && statusBlockOf(existing.body))
		);
		return { ...summaryInput, url: comment.url };
	};

	const summary = await writeSummary(approve ? 'approve' : settledVerdict);
	await db
		.update(schema.reviews)
		.set({ tier: summary.tier, tierReason: summary.tierReason })
		.where(eq(schema.reviews.id, last.id));
	// No blocking finding is left: withdraw any change request, including one an earlier review
	// left in place. Dismissing finds nothing to do when there is none.
	if (!blockingOpen) {
		await withdrawChangeRequests(connection, pullNumber, CHANGE_REQUEST_DISMISSAL, log);
	}
	const approved =
		approve && (await submitSettlementApproval(connection, pullNumber, summary, log));
	if (approve && !approved) await writeSummary(settledVerdict);
	const verdict = approved ? 'approve' : settledVerdict;
	// The approval is now Hansi's standing verdict; the next review compares against it.
	if (approved) {
		await db
			.update(schema.reviews)
			.set({ verdict: 'approve' })
			.where(eq(schema.reviews.id, last.id));
	}
	if (verdict === lastVerdict) return;
	// The check run follows the verdict and may be required for merging: a run left failing from
	// the withdrawn change request would keep blocking the pull request.
	try {
		const checkRunId = await findOwnCheckRun(octokit, ref, {
			headSha: last.headSha,
			name: 'Hansi',
			ownAppId: connection.appId
		});
		if (checkRunId) {
			await completeCheckRun(octokit, ref, checkRunId, {
				conclusion:
					verdict === 'approve' ? 'success' : verdict === 'comment' ? 'neutral' : 'failure',
				title: `Tier ${summary.tier}: ${tierMeaning[summary.tier]}`,
				summary: absolutizeLinks(
					[summary.tierReason, lastSummary].filter(Boolean).join('\n\n'),
					repository.fullName,
					last.headSha
				)
			});
		}
	} catch (error) {
		log.warn({ err: error }, 'could not update the check run after settlement');
	}
}

/**
 * Approves the reviewed commit after a settlement. The summary and the dismissal ran since the
 * head was checked, so it is read again right before the approval, which cannot then land on a
 * commit the author has already replaced. Returns whether the approval was submitted.
 */
async function submitSettlementApproval(
	{ octokit, ref }: RepositoryConnection,
	pullNumber: number,
	summary: { headSha: string; tier: Tier; url: string },
	log: Logger
): Promise<boolean> {
	try {
		const current = await getPullRequest(octokit, ref, pullNumber);
		if (current.state !== 'open' || !sameSha(current.headSha, summary.headSha)) {
			log.info(
				{ reviewedSha: summary.headSha },
				'pull request head moved before settlement approval'
			);
			return false;
		}
		await createReview(octokit, ref, {
			pullNumber,
			commitId: summary.headSha,
			event: 'APPROVE',
			body: formatReviewBody({
				tier: summary.tier,
				verdict: 'approve',
				blocking: 0,
				comments: 0,
				summaryUrl: summary.url
			}),
			comments: []
		});
		return true;
	} catch (error) {
		log.warn({ err: error }, 'could not approve after settlement');
		return false;
	}
}

function sameSha(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether settling a finding in a thread approves the pull request. The checks that need GitHub
 * run only when the remaining findings would allow an approval at all. A failed check does not
 * approve.
 */
async function approvesAfterSettlement(
	{ octokit, ref }: RepositoryConnection,
	input: {
		pullNumber: number;
		reviewedSha: string;
		lastVerdict: Verdict;
		open: { severity: Severity; category: string; title: string }[];
		diffTruncated: boolean;
		config: RepoConfig;
		log: Logger;
	}
): Promise<boolean> {
	const openVerdict = decideVerdict({ posted: [], stillOpen: input.open, config: input.config });
	const candidate = {
		lastVerdict: input.lastVerdict,
		openVerdict,
		diffTruncated: input.diffTruncated
	};
	if (
		!shouldApproveAfterSettlement({ ...candidate, headUnchanged: true, authorMayBeApproved: true })
	) {
		return false;
	}
	try {
		const pr = await getPullRequest(octokit, ref, input.pullNumber);
		const headUnchanged = pr.state === 'open' && sameSha(pr.headSha, input.reviewedSha);
		const authorMayBeApproved =
			input.config.reviews.approveOutsideContributors || (await isTrustedAuthor(octokit, ref, pr));
		return shouldApproveAfterSettlement({ ...candidate, headUnchanged, authorMayBeApproved });
	} catch (error) {
		input.log.warn({ err: error }, 'could not check whether a settlement approves');
		return false;
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
 * Dismissed findings are already excluded from `findings`.
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

	const { tier, tierReason } = standingFromOpenFindings([...posted, ...stillOpen]);

	return {
		repository: input.repository,
		headSha: input.headSha,
		summary: input.summary,
		tier,
		tierReason,
		verdict: input.verdict,
		posted,
		resolved,
		stillOpen,
		dropped,
		walkthrough: input.walkthrough,
		latestChanges: input.latestChanges,
		approvalWithheld: input.approvalWithheld,
		filesTooLargeForPrompt: input.filesTooLargeForPrompt,
		staleHead: input.staleHead,
		incrementalFrom: input.incrementalFrom,
		scope: input.scope,
		detailsUrl: input.detailsUrl,
		mention: input.mention
	};
}
