import { describe, expect, test } from 'bun:test';
import {
	formatReviewBody,
	formatSummaryComment,
	SUMMARY_MARKER,
	type SummaryInput
} from './format';

const base: SummaryInput = {
	repository: 'acme/api',
	headSha: 'abcdef1234567890',
	summary: 'Adds pagination to the items endpoint.',
	tier: 'C',
	tierReason: 'Limited by an open major finding: Off by one',
	verdict: 'request_changes',
	posted: [
		{
			path: 'src/paginate.ts',
			startLine: 3,
			endLine: 4,
			severity: 'major',
			category: 'bug',
			title: 'Off by one | skips the first page',
			body: 'b'
		}
	],
	resolved: [{ path: 'src/a.ts', startLine: 9, title: 'Missing await' }],
	stillOpen: [],
	dropped: [
		{
			path: 'src/b.ts',
			startLine: 1,
			endLine: 1,
			severity: 'info',
			category: 'maintainability',
			title: 'Naming',
			body: 'b',
			dropReason: 'Below min_severity (minor)'
		}
	],
	walkthrough: [{ path: 'src/paginate.ts', change: 'Switches to 1-based pages.\nAdds pageCount.' }],
	detailsUrl: 'https://hans.example/app/reviews/1',
	mention: '@hans-review'
};

describe('formatSummaryComment', () => {
	const body = formatSummaryComment(base);

	test('starts with the marker and the tier', () => {
		expect(body).toStartWith(`${SUMMARY_MARKER}\n\n## 🟡 Tier C · Needs changes before merging`);
		expect(body).toContain('> Limited by an open major finding: Off by one');
	});

	test('shows the verdict and counts, and links findings to their lines', () => {
		expect(body).toContain('| 🛑 Changes requested | 1 | 1 | 0 |');
		expect(body).toContain(
			'| 🟠 | Off by one \\| skips the first page | [`src/paginate.ts:3`](https://github.com/acme/api/blob/abcdef1234567890/src/paginate.ts#L3-L4) |'
		);
	});

	test('collapses the walkthrough, fixed and filtered findings', () => {
		expect(body).toContain('<summary><b>📂 Walkthrough</b> · 1</summary>');
		expect(body).toContain('| `src/paginate.ts` | Switches to 1-based pages. Adds pageCount. |');
		expect(body).toContain('- ~~Missing await~~ · `src/a.ts:9`');
		expect(body).toContain('| Naming | Below min_severity (minor) |');
		expect(body).not.toContain('Still open from earlier reviews');
	});

	test('ends with how to interact', () => {
		expect(body).toContain('Reviewed <code>abcdef1</code>');
		expect(body).toContain('<code>@hans-review review</code> to re-run');
	});
});

test('the review body is one line that points to the summary', () => {
	expect(
		formatReviewBody({
			tier: 'C',
			verdict: 'request_changes',
			blocking: 1,
			summaryUrl: 'https://x'
		})
	).toBe('🟡 **Tier C** · 1 blocking finding to address. [Summary](https://x)');
	expect(formatReviewBody({ tier: 'A', verdict: 'approve', blocking: 0 })).toBe(
		'🟢 **Tier A** · Looks good to merge.'
	);
});
