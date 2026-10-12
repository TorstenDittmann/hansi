import {
	blockingSeverity,
	severityAtLeast,
	type RepoConfig,
	type Severity,
	type Verdict
} from '@hans/config';
import { summaryWithoutSettledFindings, type PresentationFinding } from './present';
import { standingFromOpenFindings, tiers, type Tier } from './tier';
import { decideVerdict, openDefectApprovalReason } from './verdict';

/** The summary note that exists only while a bug-like finding is still open. */
const DEFECT_NOTE = 'Not approving while a bug finding is open';

export interface SettlementFinding {
	reviewId: string;
	severity: Severity;
	category: string;
	title: string;
	body: string;
	status: string;
}

/**
 * Tier headline and verdict cell describe the same standing.
 * An approval is only Tier S or A. A change request is only Tier B or worse.
 * A comment can sit beside any tier: a minor defect, `approve: false`, or a withheld approval.
 */
export function standingAgrees(tier: Tier, verdict: Verdict): boolean {
	if (verdict === 'approve') return tier === 'S' || tier === 'A';
	if (verdict === 'request_changes') return tiers.indexOf(tier) >= tiers.indexOf('B');
	return verdict === 'comment';
}

/**
 * Whether settling the thread should submit an APPROVE review.
 * An approval already on the pull request is not submitted again, and a moved head is not approved.
 */
export function shouldApproveAfterSettlement(input: {
	verdict: Verdict;
	lastDecisiveVerdict?: Verdict | null;
	headMoved: boolean;
}): boolean {
	return input.verdict === 'approve' && !input.headMoved && input.lastDecisiveVerdict !== 'approve';
}

export interface SettlementStanding {
	summary: string;
	tier: Tier;
	tierReason: string;
	verdict: Verdict;
	approvalWithheld: string | null;
}

/**
 * Grade, verdict, and summary prose after a finding is dismissed, declined, or resolved.
 * All three come from the findings that are still posted, so an approval cannot keep a stale
 * "changes requested" cell or a sentence that says a settled finding remains open.
 */
export function settlementStanding(input: {
	summary: string;
	findings: SettlementFinding[];
	latestReviewId: string;
	config: RepoConfig;
	approvalWithheld: string | null;
	/** The pull request head moved after the review. Do not approve that commit. */
	headMoved: boolean;
}): SettlementStanding {
	const open = input.findings.filter((finding) => finding.status === 'posted');
	const settled = input.findings.filter(
		(finding) => finding.status === 'dismissed' || finding.status === 'resolved'
	);
	const posted = open.filter((finding) => finding.reviewId === input.latestReviewId);
	const stillOpen = open.filter((finding) => finding.reviewId !== input.latestReviewId);
	const visible = [...posted, ...stillOpen];

	const { tier, tierReason } = standingFromOpenFindings(visible);
	let verdict = decideVerdict({ posted, stillOpen, config: input.config });
	const defectNote = openDefectApprovalReason(visible, input.config);
	let approvalWithheld = input.approvalWithheld;
	if (!approvalWithheld || approvalWithheld.startsWith(DEFECT_NOTE)) {
		approvalWithheld = defectNote;
	}
	if (input.headMoved && verdict === 'approve') verdict = 'comment';
	if (verdict === 'approve' && approvalWithheld) verdict = 'comment';
	// A change request cannot outlive the findings that justified it.
	const threshold = blockingSeverity(input.config);
	const blocking = visible.some((finding) => severityAtLeast(finding.severity, threshold));
	if (verdict === 'request_changes' && !blocking) verdict = 'comment';
	if (!standingAgrees(tier, verdict)) verdict = 'comment';

	return {
		summary: summaryWithoutSettledFindings(
			input.summary,
			toPresentation(settled),
			toPresentation(visible)
		),
		tier,
		tierReason,
		verdict,
		approvalWithheld
	};
}

function toPresentation(findings: SettlementFinding[]): PresentationFinding[] {
	return findings.map((finding) => ({
		severity: finding.severity,
		title: finding.title,
		body: finding.body
	}));
}
