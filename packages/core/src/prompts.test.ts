import { expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import {
	buildReviewPrompt,
	chatInstructions,
	formatChatContext,
	reviewerInstructions,
	verifierInstructions
} from './prompts';

const withProfile = (profile: string) =>
	parseRepoConfig(JSON.stringify({ reviews: { profile } })).config;

test('the summary describes the change, and the grade cites a finding the review will show', () => {
	const instructions = reviewerInstructions(parseRepoConfig('').config);
	expect(instructions).toContain('for a finding you are submitting or one that is still open');
	expect(instructions).toContain('do not mention problems, risks, or findings in it');
});

const files = { repository: 'appwrite/appwrite', headSha: '02feb38' };
const testingNote = {
	severity: 'minor',
	category: 'testing',
	title: 'Add regression coverage for failed file pages'
};

test('chat replies cite files as blob permalinks at the reviewed commit', () => {
	const instructions = chatInstructions('en', true, {
		repository: 'appwrite/appwrite',
		headSha: '999c0d1'
	});
	expect(instructions).toContain(
		'https://github.com/appwrite/appwrite/blob/999c0d1/<path>#L<start>-L<end>'
	);
	expect(instructions).toContain('pinned to this commit, not a branch name or a shortened SHA');
	expect(instructions).toContain('a single line is `#L<start>`');
	expect(instructions).toContain(
		'If the author says they fixed it, or convincingly explains it is not a problem, call mark_finding.'
	);
});

test('a trusted maintainer decline of a minor testing note is dismissed on the first reply', () => {
	const instructions = chatInstructions('en', true, files, {
		authorAssociation: 'MEMBER',
		finding: testingNote
	});
	expect(instructions).toContain(
		'https://github.com/appwrite/appwrite/blob/02feb38/<path>#L<start>-L<end>'
	);
	expect(instructions).toContain('call mark_finding with status dismissed on this first reply');
	expect(instructions).toContain('acknowledge briefly');
	expect(instructions).toContain('also call remember');
	expect(instructions).toContain('demonstrable factual error');
	expect(instructions).toContain('author_association');
	expect(instructions).not.toContain('convincingly explains it is not a problem');
});

test('an untrusted commenter keeps the original finding reply', () => {
	for (const authorAssociation of ['CONTRIBUTOR', 'NONE']) {
		const instructions = chatInstructions('en', true, files, {
			authorAssociation,
			finding: testingNote,
			changedGuidelines: ['AGENTS.md']
		});
		expect(instructions).toContain(
			'If the author says they fixed it, or convincingly explains it is not a problem, call mark_finding.'
		);
		expect(instructions).not.toContain('on this first reply');
		expect(instructions).not.toContain('deferred to the policy change');
		expect(instructions).toContain('Base-branch guidelines');
		expect(instructions).toContain('AGENTS.md');
	}
});

test('a member editing the cited guideline defers a non-defect note', () => {
	const instructions = chatInstructions(
		'en',
		true,
		{ repository: 'appwrite/appwrite', headSha: 'd6ed431' },
		{
			authorAssociation: 'MEMBER',
			finding: {
				severity: 'minor',
				category: 'testing',
				title: 'Keep config-contract checks outside the restricted unit tier'
			},
			changedGuidelines: ['AGENTS.md']
		}
	);
	expect(instructions).toContain('deferred to the policy change in this pull request');
	expect(instructions).toContain('Do not leave it open pending maintainer approval');
	expect(instructions).toContain('AGENTS.md');
	expect(instructions).toContain(
		'https://github.com/appwrite/appwrite/blob/d6ed431/<path>#L<start>-L<end>'
	);
});

test('a guideline edit does not settle a bug finding from a trusted commenter', () => {
	const instructions = chatInstructions('en', true, files, {
		authorAssociation: 'OWNER',
		finding: { severity: 'major', category: 'security', title: 'Token is logged' },
		changedGuidelines: ['AGENTS.md', 'CONTRIBUTING.md']
	});
	expect(instructions).toContain('keep pushing back on a preference');
	expect(instructions).toContain('bug, security, concurrency, or error-handling');
	expect(instructions).not.toContain('deferred to the policy change');
	expect(instructions).toContain('Base-branch guidelines');
	expect(instructions).toContain('AGENTS.md, CONTRIBUTING.md');
});

test('chat context names the commenter, the finding, and edited guidelines', () => {
	expect(
		formatChatContext({
			authorAssociation: 'MEMBER',
			finding: testingNote,
			changedGuidelines: ['AGENTS.md']
		})
	).toContain('<commenter association="MEMBER"/>');
	expect(
		formatChatContext({
			authorAssociation: 'MEMBER',
			finding: testingNote,
			changedGuidelines: ['AGENTS.md']
		})
	).toContain(
		'<finding severity="minor" category="testing">Add regression coverage for failed file pages</finding>'
	);
	expect(formatChatContext({ changedGuidelines: ['AGENTS.md'] })).toContain(
		'<guideline_edits>\nThis pull request modifies:\n- AGENTS.md'
	);
	expect(formatChatContext({})).toBeUndefined();
});

test('balanced and strict review tests and docs; only strict adds naming, style, and maintainability', () => {
	for (const profile of ['balanced', 'strict'] as const) {
		const instructions = reviewerInstructions(withProfile(profile));
		expect(instructions).toContain('tests coupled to implementation details (private call order');
		expect(instructions).toContain('README examples that would not work as written');
		expect(verifierInstructions(profile)).toContain('missing or ineffective tests');
	}
	expect(reviewerInstructions(withProfile('chill'))).not.toContain('tests coupled');
	expect(verifierInstructions('chill')).not.toContain('missing or ineffective tests');

	const strict = reviewerInstructions(withProfile('strict'));
	expect(strict).toContain('Naming and style rules count too');
	expect(strict).toContain('Maintainability problems');
	expect(strict).toContain(
		'Never report formatting, import order, or anything a linter would catch.'
	);
	expect(verifierInstructions('strict')).toContain(
		'you can see the violation in the code. Formatting rules do not count.'
	);

	const balanced = reviewerInstructions(withProfile('balanced'));
	expect(balanced).toContain('Do not report formatting, naming, or style rules.');
	expect(balanced).not.toContain('Maintainability problems');
	expect(verifierInstructions('balanced')).toContain(
		'Formatting, naming, and style rules do not count.'
	);
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

test('traces retry and claim lifecycles, including a marker written before the call succeeds', () => {
	const instructions = reviewerInstructions(parseRepoConfig('').config);
	expect(instructions).toContain('timestamp reset on every requeue');
	expect(instructions).toContain("wipe a successor's claim");
	expect(instructions).toContain('sessionStorage or localStorage flag');
	expect(instructions).toContain('onError that only shows a toast');
	expect(instructions).toContain('fails the same way as the primary');
	expect(instructions).toContain('reserve and claim happen in the same call');
	expect(instructions).toContain('name that failure in tier_reason');
	expect(verifierInstructions('balanced')).toContain('marker it does not own');
	expect(verifierInstructions('chill')).toContain('not cleared on failure');
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

test('a trusted factual rebuttal of a bug finding dismisses it', () => {
	const instructions = chatInstructions('en', true, files, {
		authorAssociation: 'MEMBER',
		finding: { severity: 'major', category: 'bug', title: 'Preserve configured passkey origins' }
	});
	expect(instructions).toContain("finding's premise is false");
	expect(instructions).toContain('list_refs and path_in_refs');
	expect(instructions).toContain('refs_containing');
	expect(instructions).toContain('git branch -r --contains');
	expect(instructions).toContain('git tag --contains');
	expect(instructions).toContain('never call such a claim unverifiable');
	expect(instructions).toContain('could not verify it');
	expect(instructions).toContain('Do not repeat an argument');
	expect(instructions).not.toContain('demonstrable factual error');
	expect(instructions).not.toContain('at least their second reasoned decline');
});

test('a second reasoned decline of a non-security finding is dismissed', () => {
	const instructions = chatInstructions('en', true, files, {
		authorAssociation: 'MEMBER',
		finding: { severity: 'minor', category: 'bug', title: 'Preserve configured passkey origins' },
		reasonedDeclines: 2
	});
	expect(instructions).toContain('at least their second reasoned decline');
	expect(instructions).toContain('call mark_finding with status dismissed on this reply');
	expect(instructions).toContain('git branch -r --contains');
	expect(instructions).not.toContain('keep pushing back on a preference');
});

test('a security finding is not dropped just because it was declined twice', () => {
	const instructions = chatInstructions('en', true, files, {
		authorAssociation: 'OWNER',
		finding: { severity: 'minor', category: 'security', title: 'actions: write is unused' },
		reasonedDeclines: 2
	});
	expect(instructions).toContain('concrete exploit path');
	expect(instructions).not.toContain('at least their second reasoned decline');
});

test('a review checks release history before reporting a break for existing users', () => {
	const instructions = reviewerInstructions(parseRepoConfig('').config);
	expect(instructions).toContain('refs_containing');
	expect(instructions).toContain('git branch -r --contains');
	expect(instructions).toContain('git tag --contains');
	expect(instructions).toContain(
		'Do not call that history unverifiable without running the tools.'
	);
});

test('a fix on a guideline edit is resolved, not dismissed as deferred', () => {
	const instructions = chatInstructions(
		'en',
		true,
		{ repository: 'appwrite/appwrite', headSha: '267c14f' },
		{
			authorAssociation: 'MEMBER',
			finding: {
				severity: 'minor',
				category: 'documentation',
				title: 'Fix the nonexistent Pool example link'
			},
			changedGuidelines: ['AGENTS.md'],
			authorFixed: true
		}
	);
	expect(instructions).toContain('call mark_finding with status resolved');
	expect(instructions).toContain('say the finding is fixed');
	expect(instructions).not.toContain('deferred to the policy change');
	expect(instructions).toContain('Do not say the finding is dismissed');
	expect(instructions).toContain('https://github.com/appwrite/appwrite/blob/267c14f/');
});

test('a maintainer handoff is acknowledged once and does not hold the verdict', () => {
	const instructions = chatInstructions('en', true, files, {
		authorAssociation: 'MEMBER',
		finding: { severity: 'minor', category: 'bug', title: 'Treat unbound cursors as stale' },
		maintainerHandoff: true
	});
	expect(instructions).toContain('Awaiting a maintainer decision');
	expect(instructions).toContain('status deferred');
	expect(instructions).toContain('must not hold the verdict');
	expect(instructions).toContain('If a reply brings new evidence');
	expect(instructions).toContain('Do not say you are keeping the finding open');
});

test('chat context records how many reasoned declines are already in the thread', () => {
	expect(formatChatContext({ reasonedDeclines: 2 })).toBe('<reasoned_declines count="2"/>');
	expect(formatChatContext({ reasonedDeclines: 0 })).toBeUndefined();
});
