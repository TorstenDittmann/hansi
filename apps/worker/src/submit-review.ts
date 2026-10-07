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

export interface HeadSubmissionInput {
	/** Commit the review was computed against. */
	reviewedSha: string;
	/** Pull request head read immediately before the review is submitted. */
	currentHeadSha: string;
	verdict: Verdict;
	/** Inline findings that would be posted on the reviewed commit. */
	posted: number;
	/**
	 * Whether `shouldSubmitReview` would submit if the head were unchanged.
	 * A moved head never turns a skipped review into an approval.
	 */
	shouldSubmit: boolean;
}

export interface HeadSubmission {
	headMoved: boolean;
	/** Verdict to record, show in the summary, and map onto the GitHub review event. */
	verdict: Verdict;
	/** Create a GitHub review. False skips an approval that would land on a stale commit. */
	submit: boolean;
	/** Summary note when newer commits exist. Null when the head is unchanged. */
	note: string | null;
}

/** Shown in the summary when the pull request moved on while this review was running. */
export function staleHeadNote(reviewedSha: string, currentHeadSha: string): string {
	const reviewed = reviewedSha.slice(0, 7);
	const current = currentHeadSha.slice(0, 7);
	return `Newer commits exist (\`${current}\`) and will be reviewed. This review is of \`${reviewed}\` and does not approve it.`;
}

/**
 * What to submit after re-reading the pull request head.
 *
 * The review runs for minutes against one commit. If the head moved, an APPROVE or
 * REQUEST_CHANGES on that commit would bless or block code the author already replaced.
 * Inline comments still post on the reviewed commit. A review whose only effect was that
 * decisive event is skipped. An unchanged head is left to `shouldSubmitReview`.
 */
export function submissionForCurrentHead(input: HeadSubmissionInput): HeadSubmission {
	const headMoved = input.reviewedSha.toLowerCase() !== input.currentHeadSha.toLowerCase();
	if (!headMoved) {
		return {
			headMoved: false,
			verdict: input.verdict,
			submit: input.shouldSubmit,
			note: null
		};
	}
	return {
		headMoved: true,
		verdict: 'comment',
		submit: input.posted > 0,
		note: staleHeadNote(input.reviewedSha, input.currentHeadSha)
	};
}
