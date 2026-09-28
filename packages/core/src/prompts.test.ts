import { expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import { buildReviewPrompt, reviewerInstructions, verifierInstructions } from './prompts';

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
	expect(prompt).not.toContain('<files_not_shown>');
});

test('says why files are not shown, and asks for callers of deleted files', () => {
	const ignored = buildReviewPrompt({
		...base,
		excludedFiles: [{ path: 'bun.lock', reason: 'ignored by default' }]
	});
	expect(ignored).toContain('- bun.lock (ignored by default)');
	expect(ignored).not.toContain('Deleted files');

	const deleted = buildReviewPrompt({
		...base,
		excludedFiles: [
			{ path: 'src/legacy.ts', reason: 'deleted' },
			{ path: 'src/big.ts', reason: 'too large to show' }
		]
	});
	expect(deleted).toContain('- src/legacy.ts (deleted)\n- src/big.ts (too large to show)');
	expect(deleted).toContain('Deleted files may still be imported');
});

test('treats repository guidelines as rules the review has to apply', () => {
	const prompt = buildReviewPrompt({
		...base,
		guidelines:
			'<file path="AGENTS.md">\nDo not run Swoole coroutine work in the shared unit process.\n</file>'
	});
	expect(prompt).toContain('Do not run Swoole coroutine work in the shared unit process.');
	expect(prompt).toContain('Project rules from every instruction file.');

	const instructions = reviewerInstructions(base.config);
	expect(instructions).toContain('A concrete project rule is not a style opinion.');
	expect(instructions).toContain('not from this pull request');
	expect(verifierInstructions('balanced')).toContain(
		'the changed code breaks a concrete rule in <repository_guidelines>'
	);
});
