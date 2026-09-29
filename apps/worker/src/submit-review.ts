import type { Tier, Verdict } from '@hans/config';

/**
 * Whether this review should be submitted on the pull request, not only written into the summary.
 *
 * Inline comments and a changed approve / request-changes state always show up. A re-review asked
 * for in a mention does too. Reaching Tier S also does: earlier grades usually leave a review
 * because they have inline comments, and a clean follow-up used to edit only the summary — even
 * when the author cannot be approved and the GitHub event stays a comment.
 */
export function shouldSubmitReview(input: {
	posted: number;
	verdict: Verdict;
	tier: Tier;
	previousTier?: Tier | null;
	lastDecisiveVerdict?: Verdict | null;
	trigger: string;
}): boolean {
	const stateChanged = input.verdict !== 'comment' && input.verdict !== input.lastDecisiveVerdict;
	const reachedTierS = input.tier === 'S' && input.previousTier !== 'S';
	return input.posted > 0 || stateChanged || input.trigger === 'mention' || reachedTierS;
}
