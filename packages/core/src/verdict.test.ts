import { describe, expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import { formatReviewBody } from './format';
import { finalTier, tierCap } from './tier';
import { decideVerdict } from './verdict';

const config = (yaml = '') => parseRepoConfig(yaml).config;

describe('decideVerdict', () => {
	test('requests changes for new blocking findings', () => {
		expect(decideVerdict({ posted: [{ severity: 'major' }], stillOpen: 0, config: config() })).toBe(
			'request_changes'
		);
	});

	test('approves with only minor comments', () => {
		expect(decideVerdict({ posted: [{ severity: 'minor' }], stillOpen: 0, config: config() })).toBe(
			'approve'
		);
	});

	test('keeps an earlier request for changes in place while blockers are open', () => {
		expect(decideVerdict({ posted: [], stillOpen: 1, config: config() })).toBe('comment');
	});

	test('respects request_changes and approve settings', () => {
		const never = config('reviews:\n  request_changes: never\n');
		expect(decideVerdict({ posted: [{ severity: 'critical' }], stillOpen: 0, config: never })).toBe(
			'comment'
		);
		const strict = config('reviews:\n  request_changes: minor\n');
		expect(decideVerdict({ posted: [{ severity: 'minor' }], stillOpen: 0, config: strict })).toBe(
			'request_changes'
		);
		const noApprove = config('reviews:\n  approve: false\n');
		expect(decideVerdict({ posted: [], stillOpen: 0, config: noApprove })).toBe('comment');
	});
});

describe('tiers', () => {
	test('the worst open finding caps the tier', () => {
		expect(tierCap([])).toBe('S');
		expect(tierCap(['info'])).toBe('A');
		expect(tierCap(['minor', 'info'])).toBe('B');
		expect(tierCap(['minor', 'major'])).toBe('C');
		expect(tierCap(['critical'])).toBe('D');
	});

	test('the model can only make the tier worse, never better than the cap', () => {
		expect(finalTier('S', 'C')).toBe('C');
		expect(finalTier('F', 'D')).toBe('F');
		expect(finalTier('B', 'S')).toBe('B');
		expect(finalTier(undefined, 'B')).toBe('B');
	});
});

test('the review body leads with the tier', () => {
	const body = formatReviewBody({
		summary: 'Adds pagination.',
		tier: 'C',
		tierReason: 'Limited by an open major finding: Off by one',
		posted: 1,
		dropped: 0,
		resolved: 1,
		stillOpen: 0,
		reviewedFiles: 2
	});
	expect(body).toStartWith(
		'### hans review · Tier C\n\n**Needs changes before merging.** Limited by an open major finding'
	);
	expect(body).toContain('1 comment on 2 reviewed files. 1 earlier finding fixed.');
});
