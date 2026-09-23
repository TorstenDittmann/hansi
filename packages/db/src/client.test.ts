import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDatabaseUrl } from './client';

let root: string;
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'hans-root-'));
	await writeFile(join(root, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
	await mkdir(join(root, 'apps/web'), { recursive: true });
	await writeFile(join(root, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
});
afterAll(() => rm(root, { recursive: true, force: true }));

test('relative file URLs resolve against the workspace root from any package', () => {
	const expected = `file:${join(root, 'data/hans.db')}`;
	expect(resolveDatabaseUrl('file:./data/hans.db', root)).toBe(expected);
	expect(resolveDatabaseUrl('file:./data/hans.db', join(root, 'apps/web'))).toBe(expected);
});

test('absolute, in-memory, and remote URLs are unchanged', () => {
	expect(resolveDatabaseUrl('file:/data/hans.db', root)).toBe('file:/data/hans.db');
	expect(resolveDatabaseUrl(':memory:', root)).toBe(':memory:');
	expect(resolveDatabaseUrl('libsql://db.turso.io', root)).toBe('libsql://db.turso.io');
	expect(resolveDatabaseUrl('http://sqld:8080', root)).toBe('http://sqld:8080');
});
