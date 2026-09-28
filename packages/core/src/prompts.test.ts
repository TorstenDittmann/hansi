import { expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import {
	buildReviewPrompt,
	enforcedRuleSections,
	reviewerInstructions,
	verifierInstructions
} from './prompts';

const withProfile = (profile: string) =>
	parseRepoConfig(JSON.stringify({ reviews: { profile } })).config;

const allRules = {
	guidelines: 'Do not add regular expressions.',
	learnings: ['We do not flag this in tests.'],
	instructions: 'Use Result types.',
	pathInstructions: ['For files matching migrations/**: Check reversibility.']
};

test('every profile enforces the rules the team wrote, but only strict the guidelines', () => {
	const configured = ['<review_instructions>', '<path_instructions>', '<team_learnings>'];
	expect(enforcedRuleSections('chill', allRules)).toEqual(configured);
	expect(enforcedRuleSections('balanced', allRules)).toEqual(configured);
	expect(enforcedRuleSections('strict', allRules)).toEqual([
		'<repository_guidelines>',
		...configured
	]);
	expect(
		enforcedRuleSections('balanced', {
			guidelines: 'Use tabs.',
			instructions: ' ',
			pathInstructions: []
		})
	).toEqual([]);
});

test('names the enforced sections in both passes, and says nothing without any', () => {
	const enforced = enforcedRuleSections('strict', { ...allRules, learnings: [] });
	const sections = '<repository_guidelines>, <review_instructions>, and <path_instructions>';
	const strict = reviewerInstructions(withProfile('strict'), enforced);
	expect(strict).toContain(`The team's rules in ${sections} come before these defaults.`);
	expect(strict).toContain(
		'Never report formatting, import order, or anything a linter would catch, unless a team rule asks for it.'
	);
	expect(verifierInstructions('strict', enforced)).toContain(
		`breaks a rule stated in ${sections},`
	);

	const balanced = reviewerInstructions(withProfile('balanced'));
	expect(balanced).not.toContain(`The team's rules in`);
	expect(balanced).toContain(
		'Never report formatting, style, naming, missing comments, import order, or anything a linter would catch.'
	);
	expect(verifierInstructions('balanced')).not.toContain('also keep');
});

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
