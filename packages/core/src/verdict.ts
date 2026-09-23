import {
	blockingSeverity,
	severityAtLeast,
	type RepoConfig,
	type Severity,
	type Verdict
} from '@hans/config';

export type { Verdict } from '@hans/config';

export interface VerdictInput {
	/** Findings posted by this review. */
	posted: { severity: Severity }[];
	/** Blocking findings from earlier reviews that are still unresolved after this one. */
	stillOpen: number;
	config: RepoConfig;
}

/**
 * GitHub shows each reviewer's latest approve / request-changes review, so the verdict must
 * reflect the whole PR, not just the newest commits:
 * - new blocking findings → request changes (or only comment when `requestChanges: never`)
 * - blocking findings from earlier reviews still open → comment, which leaves the earlier
 *   "changes requested" in place
 * - otherwise → approve (inline comments for minor findings are fine), unless `approve: false`
 */
export function decideVerdict({ posted, stillOpen, config }: VerdictInput): Verdict {
	const threshold = blockingSeverity(config);
	const blocking = posted.some((finding) => severityAtLeast(finding.severity, threshold));
	if (blocking) return config.reviews.requestChanges === 'never' ? 'comment' : 'request_changes';
	if (stillOpen > 0) return 'comment';
	return config.reviews.approve ? 'approve' : 'comment';
}
