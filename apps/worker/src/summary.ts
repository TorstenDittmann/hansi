import {
	formatSummaryComment,
	standingFromOpenFindings,
	SUMMARY_MARKER,
	type Finding,
	type SummaryInput
} from '@hans/core';
import { schema, type Database } from '@hans/db';
import { upsertMarkedComment } from '@hans/github';
import type { Severity, Verdict } from '@hans/config';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { RepositoryConnection } from './shared';

type FindingRow = {
	reviewId: string;
	path: string;
	startLine: number;
	endLine: number;
	severity: string;
	category: string;
	title: string;
	body: string;
	status: string;
	dropReason: string | null;
};

/** Rebuilds the summary comment after a finding is resolved or dismissed in a thread. */
export async function refreshSummaryAfterSettlement(input: {
	db: Database;
	env: { APP_URL: string };
	connection: RepositoryConnection;
	organizationId: string;
	repositoryId: number;
	pullNumber: number;
}): Promise<void> {
	const { db, env, connection, organizationId, repositoryId, pullNumber } = input;
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

	const rows = await db
		.select({
			reviewId: schema.reviewFindings.reviewId,
			path: schema.reviewFindings.path,
			startLine: schema.reviewFindings.startLine,
			endLine: schema.reviewFindings.endLine,
			severity: schema.reviewFindings.severity,
			category: schema.reviewFindings.category,
			title: schema.reviewFindings.title,
			body: schema.reviewFindings.body,
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
				ne(schema.reviewFindings.status, 'dismissed')
			)
		)
		.limit(200);

	const summaryInput = summaryAfterSettlement({
		repository: repository.fullName,
		headSha: last.headSha,
		summary: last.summary,
		verdict: last.verdict as Verdict,
		walkthrough: last.walkthrough ?? [],
		latestReviewId: last.id,
		findings: rows,
		detailsUrl: `${env.APP_URL.replace(/\/+$/, '')}/app/reviews/${last.id}`,
		mention
	});

	await upsertMarkedComment(
		octokit,
		ref,
		pullNumber,
		SUMMARY_MARKER,
		formatSummaryComment(summaryInput)
	);
	await db
		.update(schema.reviews)
		.set({ tier: summaryInput.tier, tierReason: summaryInput.tierReason })
		.where(eq(schema.reviews.id, last.id));
}

/**
 * Turns the latest review plus remaining findings into a summary comment body.
 * Dismissed findings are already excluded from `findings`.
 */
export function summaryAfterSettlement(input: {
	repository: string;
	headSha: string;
	summary: string;
	verdict: Verdict;
	walkthrough: { path: string; change: string }[];
	latestReviewId: string;
	findings: FindingRow[];
	detailsUrl: string;
	mention: string;
}): SummaryInput {
	const toFinding = (row: FindingRow): Finding => ({
		path: row.path,
		startLine: row.startLine,
		endLine: row.endLine,
		severity: row.severity as Severity,
		category: row.category as Finding['category'],
		title: row.title,
		body: row.body
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
			title: f.title,
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
		detailsUrl: input.detailsUrl,
		mention: input.mention
	};
}
