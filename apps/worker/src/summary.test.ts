import { describe, expect, test } from 'bun:test';
import { formatSummaryComment } from '@hans/core';
import { summaryAfterSettlement } from './summary';

const base = {
	repository: 'acme/api',
	headSha: 'abcdef1234567890',
	summary: 'Adds pagination to the items endpoint.',
	verdict: 'approve' as const,
	walkthrough: [{ path: 'src/paginate.ts', change: 'Switches to 1-based pages.' }],
	latestReviewId: 'review-2',
	detailsUrl: 'https://hans.example/app/reviews/review-2',
	mention: '@hansi-codes'
};

const earlierFinding = {
	reviewId: 'review-1',
	path: 'apps/web/src/routes/+layout.svelte',
	startLine: 112,
	endLine: 112,
	severity: 'minor',
	category: 'bug',
	title: '/api responses bypass this robots meta tag',
	body: 'API responses never see the layout meta tag.',
	status: 'posted',
	dropReason: null
};

describe('summaryAfterSettlement', () => {
	test('dropping the last open finding clears it from the summary and grades S', () => {
		const input = summaryAfterSettlement({
			...base,
			findings: []
		});
		expect(input.tier).toBe('S');
		expect(input.tierReason).toBe('');
		expect(input.stillOpen).toEqual([]);

		const body = formatSummaryComment(input);
		expect(body).toContain('## 🟢 Tier S');
		expect(body).toContain('| ✅ Approved | 0 | 0 | 0 |');
		expect(body).not.toContain('Still open from earlier reviews');
		expect(body).not.toContain('/api responses bypass');
	});

	test('keeps other earlier findings in the still-open list', () => {
		const input = summaryAfterSettlement({
			...base,
			findings: [earlierFinding]
		});
		expect(input.tier).toBe('A');
		expect(input.tierReason).toBe(
			'Limited by an open minor finding: /api responses bypass this robots meta tag'
		);
		expect(input.stillOpen).toEqual([
			{
				path: earlierFinding.path,
				startLine: 112,
				title: earlierFinding.title,
				severity: 'minor'
			}
		]);

		const body = formatSummaryComment(input);
		expect(body).toContain('Still open from earlier reviews');
		expect(body).toContain('/api responses bypass this robots meta tag');
	});

	test('findings from the latest review stay under new comments, not still open', () => {
		const input = summaryAfterSettlement({
			...base,
			findings: [{ ...earlierFinding, reviewId: 'review-2' }]
		});
		expect(input.posted).toHaveLength(1);
		expect(input.stillOpen).toEqual([]);
		expect(input.tier).toBe('A');
	});
});
