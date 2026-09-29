import { expect, test } from 'bun:test';
import { shouldSubmitReview } from './submit-review';

const quiet = {
	posted: 0,
	verdict: 'comment' as const,
	tier: 'S' as const,
	previousTier: 'A' as const,
	lastDecisiveVerdict: null,
	trigger: 'synchronize'
};

test('reaching Tier S leaves a review even when approval stays a comment', () => {
	expect(shouldSubmitReview(quiet)).toBe(true);
});

test('the first clean review leaves a review', () => {
	expect(shouldSubmitReview({ ...quiet, previousTier: undefined })).toBe(true);
});

test('a later Tier S review with nothing new stays in the summary', () => {
	expect(shouldSubmitReview({ ...quiet, previousTier: 'S' })).toBe(false);
});

test('inline comments, a new approval, and a mention still submit', () => {
	expect(shouldSubmitReview({ ...quiet, previousTier: 'S', posted: 1, tier: 'A' })).toBe(true);
	expect(
		shouldSubmitReview({
			...quiet,
			previousTier: 'S',
			verdict: 'approve',
			lastDecisiveVerdict: null
		})
	).toBe(true);
	expect(
		shouldSubmitReview({
			...quiet,
			previousTier: 'S',
			verdict: 'approve',
			lastDecisiveVerdict: 'approve'
		})
	).toBe(false);
	expect(shouldSubmitReview({ ...quiet, previousTier: 'S', trigger: 'mention' })).toBe(true);
});
