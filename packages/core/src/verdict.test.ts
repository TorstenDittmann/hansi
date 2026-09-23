import { describe, expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import { finalTier, tierCap } from './tier';
import { decideVerdict } from './verdict';

const config = (json = '') => parseRepoConfig(json).config;

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

	test('respects requestChanges and approve settings', () => {
		const never = config('{ "reviews": { "requestChanges": "never" } }');
		expect(decideVerdict({ posted: [{ severity: 'critical' }], stillOpen: 0, config: never })).toBe(
			'comment'
		);
		const strict = config('{ "reviews": { "requestChanges": "minor" } }');
		expect(decideVerdict({ posted: [{ severity: 'minor' }], stillOpen: 0, config: strict })).toBe(
			'request_changes'
		);
		const noApprove = config('{ "reviews": { "approve": false } }');
		expect(decideVerdict({ posted: [], stillOpen: 0, config: noApprove })).toBe('comment');
	});
});

describe('tiers', () => {
	test('the worst open finding caps the tier', () => {
		expect(tierCap([])).toBe('S');
		expect(tierCap(['info'])).toBe('S');
		expect(tierCap(['minor', 'info'])).toBe('A');
		expect(tierCap(['minor', 'major'])).toBe('B');
		expect(tierCap(['critical'])).toBe('D');
	});

	test('the model can only make the tier worse, never better than the cap', () => {
		expect(finalTier('S', 'C')).toBe('C');
		expect(finalTier('F', 'D')).toBe('F');
		expect(finalTier('B', 'S')).toBe('B');
		expect(finalTier(undefined, 'B')).toBe('B');
	});
});
