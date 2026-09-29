import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	formatRepoGuidelines,
	GUIDELINE_LIMIT_BYTES,
	includeOnlyTargets,
	loadRepoGuidelines,
	parseAllowRegex,
	ruleSourceForPath
} from './tools';

let root: string;

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'hans-rules-'));
});

afterAll(() => rm(root, { recursive: true, force: true }));

async function fixture(name: string, files: Record<string, string>) {
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const absolute = join(dir, path);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, content);
	}
	return dir;
}

describe('loadRepoGuidelines', () => {
	test('skips missing files silently and returns an empty payload', async () => {
		const dir = await fixture('empty', { 'src/a.ts': 'export const a = 1;\n' });
		const rules = await loadRepoGuidelines(dir);
		expect(rules.files).toEqual([]);
		expect(rules.body).toBe('');
		expect(rules.truncated).toBe(false);
		expect(rules.manifest).toBe('- (none)');
		expect(formatRepoGuidelines(rules)).toBe('');
	});

	test('loads AGENTS.md, CLAUDE.md, and Hansi-native files from the checkout (PR head)', async () => {
		const dir = await fixture('head', {
			'AGENTS.md': 'Do not add regular expressions without justification.\n',
			'CLAUDE.md': 'Isolate coroutine tests from the shared process.\n',
			'.hansi.md': 'allow_regex: false\nprefer sparse Document updates.\n',
			'.hansi/rules.md': 'Flag implementation-coupled tests.\n',
			'.github/hansi/extra.md': 'Prefer existing validators over new regex.\n'
		});
		const rules = await loadRepoGuidelines(dir);
		expect(rules.files.map((file) => [file.path, file.source])).toEqual([
			['.hansi.md', 'hansi-config'],
			['.hansi/rules.md', 'hansi-config'],
			['.github/hansi/extra.md', 'hansi-config'],
			['AGENTS.md', 'agents'],
			['CLAUDE.md', 'claude']
		]);
		expect(rules.body).toContain('prefer sparse Document updates');
		expect(rules.body).toContain('Do not add regular expressions');
		expect(rules.body).toContain('Isolate coroutine tests');
		expect(rules.manifest).toContain('`.hansi.md` (hansi-config); overrides: allow_regex=false');
		expect(rules.manifest).toContain('`AGENTS.md` (agents)');
		expect(rules.overrides.allowRegex).toBe(false);
	});

	test('treats .hansi as a directory without error and still loads .hansi/rules', async () => {
		const dir = await fixture('hansi-dir', {
			'.hansi/rules.md': 'No unit tests for workers.\n',
			'AGENTS.md': 'Unit tests cover local src libraries only.\n'
		});
		const rules = await loadRepoGuidelines(dir);
		expect(rules.files.map((file) => file.path)).toEqual(['.hansi/rules.md', 'AGENTS.md']);
		expect(rules.body).toContain('No unit tests for workers.');
	});

	test('dedupes a CLAUDE.md that only includes @AGENTS.md', async () => {
		const dir = await fixture('include', {
			'AGENTS.md': 'Do not run Swoole coroutine work in the shared unit process.\n',
			'CLAUDE.md': '@AGENTS.md\n'
		});
		const rules = await loadRepoGuidelines(dir);
		expect(rules.files.map((file) => file.path)).toEqual(['AGENTS.md']);
		expect(rules.skipped).toEqual([
			{ path: 'CLAUDE.md', source: 'claude', reason: 'include of AGENTS.md' }
		]);
		expect(rules.body).toContain('Do not run Swoole coroutine work');
		expect(rules.body).not.toContain('@AGENTS.md');
		expect(rules.manifest).toContain('`CLAUDE.md` (claude) — skipped: include of AGENTS.md');
	});

	test('dedupes identical content, keeping the higher-precedence copy', async () => {
		const same = 'Do not unit-test HTTP route actions.\n';
		const dir = await fixture('dupes', {
			'AGENTS.md': same,
			'.github/AGENTS.md': same,
			'CLAUDE.md': same
		});
		const rules = await loadRepoGuidelines(dir);
		expect(rules.files.map((file) => file.path)).toEqual(['AGENTS.md']);
		expect(rules.skipped.map((file) => file.reason)).toEqual([
			'duplicate content',
			'duplicate content'
		]);
	});

	test('keeps higher-precedence files when truncating to the cap', async () => {
		const dir = await fixture('truncate', {
			'.hansi': 'hansi-high-precedence\n',
			'AGENTS.md': `${'A'.repeat(80)}\n`,
			'CLAUDE.md': `${'C'.repeat(80)}\n`
		});
		const rules = await loadRepoGuidelines(dir, { maxBytes: 180 });
		expect(rules.truncated).toBe(true);
		expect(rules.files[0]?.path).toBe('.hansi');
		expect(rules.body).toContain('hansi-high-precedence');
		expect(rules.body).toContain('[rules truncated]');
		const prompt = formatRepoGuidelines(rules);
		expect(prompt).toContain('## Repository review rules');
		expect(prompt).toContain('[rules truncated]');
		expect(prompt.startsWith('<repository_guidelines>')).toBe(true);
	});

	test('uses the 24 KB default cap', async () => {
		expect(GUIDELINE_LIMIT_BYTES).toBe(24 * 1024);
		const dir = await fixture('cap-default', {
			'AGENTS.md': `${'Keep this rule.\n'.repeat(20)}`
		});
		const rules = await loadRepoGuidelines(dir);
		expect(rules.truncated).toBe(false);
		expect(Buffer.byteLength(rules.body, 'utf8')).toBeLessThanOrEqual(GUIDELINE_LIMIT_BYTES);
	});

	test('records allow_regex: true from .hansi in the manifest', async () => {
		const dir = await fixture('allow-regex', {
			'.hansi': 'allow_regex: true\n',
			'AGENTS.md': 'Do not add regular expressions.\n'
		});
		const rules = await loadRepoGuidelines(dir);
		expect(rules.overrides.allowRegex).toBe(true);
		expect(rules.manifest).toContain('overrides: allow_regex=true');
		expect(formatRepoGuidelines(rules)).toContain('allow_regex=true');
	});

	test('still loads extra instruction files at lowest precedence', async () => {
		const dir = await fixture('extras', {
			'AGENTS.md': 'Agents rule.\n',
			'.cursorrules': 'Cursor rule.\n',
			'.github/copilot-instructions.md': 'Copilot rule.\n',
			'CONTRIBUTING.md': 'Keep the contributing notes.\n'
		});
		const rules = await loadRepoGuidelines(dir);
		expect(rules.files.map((file) => file.path)).toEqual([
			'AGENTS.md',
			'.cursorrules',
			'.github/copilot-instructions.md',
			'CONTRIBUTING.md'
		]);
		expect(rules.body).toContain('<file path=".cursorrules">');
		expect(rules.body).toContain('Keep the contributing notes.');
	});
});

test('ruleSourceForPath classifies the documented files', () => {
	expect(ruleSourceForPath('AGENTS.md')).toBe('agents');
	expect(ruleSourceForPath('.github/AGENTS.md')).toBe('agents');
	expect(ruleSourceForPath('AGENT.md')).toBe('agents');
	expect(ruleSourceForPath('CLAUDE.md')).toBe('claude');
	expect(ruleSourceForPath('.hansi')).toBe('hansi-config');
	expect(ruleSourceForPath('.hansi/rules/style.md')).toBe('hansi-config');
	expect(ruleSourceForPath('hansi.toml')).toBe('hansi-config');
});

test('includeOnlyTargets detects @file includes', () => {
	expect(includeOnlyTargets('@AGENTS.md\n')).toEqual(['AGENTS.md']);
	expect(includeOnlyTargets('@./AGENTS.md\n@CLAUDE.md\n')).toEqual(['AGENTS.md', 'CLAUDE.md']);
	expect(includeOnlyTargets('See AGENTS.md\n')).toBeNull();
});

test('parseAllowRegex reads json, yaml, and toml', () => {
	expect(parseAllowRegex('{"allow_regex": true}')).toBe(true);
	expect(parseAllowRegex('allow_regex: false\n')).toBe(false);
	expect(parseAllowRegex('allow_regex = true\n')).toBe(true);
	expect(parseAllowRegex('no such key\n')).toBeUndefined();
});
