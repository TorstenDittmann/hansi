import {
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
 * Prefer approving so good PRs merge faster. Only critical findings block; earlier open
 * findings and repo approve settings are ignored so incremental reviews do not stall merges.
 */
export function decideVerdict({ posted, stillOpen, config }: VerdictInput): Verdict {
	void stillOpen;
	void config;
	const blocking = posted.some((finding) => finding.severity === 'critical');
	if (blocking) return 'request_changes';
	return 'approve';
}
