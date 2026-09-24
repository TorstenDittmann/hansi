import { expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import { buildReviewPrompt } from './prompts';

const base = {
	title: 'Fix rounding',
	body: '',
	author: 'octocat',
	guidelines: '',
	config: parseRepoConfig(null).config,
	pathInstructions: [],
	diff: '(diff)',
	excludedFiles: []
};

test('includes linked issues and failed checks when there are any', () => {
	const prompt = buildReviewPrompt({
		...base,
		linkedIssues: [{ number: 12, title: 'Totals are off by a cent', body: 'Round half up.' }],
		failedChecks: [
			{
				name: 'test',
				conclusion: 'failure',
				output: '1 test failed',
				annotations: [{ path: 'src/money.ts', line: 4, message: 'expected 1.01, got 1.00' }]
			}
		]
	});
	expect(prompt).toContain(
		'<issue number="12">\n<title>Totals are off by a cent</title>\nRound half up.\n</issue>'
	);
	expect(prompt).toContain(
		'<check name="test" conclusion="failure">\n1 test failed\n- src/money.ts:4: expected 1.01, got 1.00\n</check>'
	);
});

test('leaves the sections out when there is nothing to show', () => {
	const prompt = buildReviewPrompt({ ...base, linkedIssues: [], failedChecks: [] });
	expect(prompt).not.toContain('<linked_issues>');
	expect(prompt).not.toContain('<failed_checks>');
});
