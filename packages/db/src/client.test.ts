import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, resolveDatabaseUrl, splitBasicAuth } from './client';
import { runMigrations } from './migrate';

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

describe('local file databases', () => {
	let dir: string;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'hans-db-'));
	});
	afterAll(() => rm(dir, { recursive: true, force: true }));

	test('a second process waits for a lock instead of failing with SQLITE_BUSY', async () => {
		const path = join(dir, 'locks.db');
		const web = createDatabase({ url: `file:${path}` });
		await web.ready;
		await web.client.execute('create table t (n integer)');

		// Another process (like the worker) holds the write lock for a moment. It must be a real
		// process: libSQL's local driver blocks the thread while it waits for a lock.
		const holder = Bun.spawn(
			[
				'bun',
				'-e',
				`import { createClient } from '@libsql/client';
				const c = createClient({ url: 'file:${path}' });
				const tx = await c.transaction('write');
				await tx.execute('insert into t values (1)');
				console.log('locked');
				await Bun.sleep(500);
				await tx.commit();`
			],
			{ cwd: import.meta.dir, stdout: 'pipe' }
		);
		const reader = holder.stdout.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toContain('locked');

		// Concurrent queries, as a server or the worker's parallel loops make them. The old pooled
		// client ran the second one on a fresh connection without a busy timeout: SQLITE_BUSY.
		const started = performance.now();
		await Promise.all([
			web.client.execute('select count(*) from t'),
			web.client.execute('insert into t values (2)')
		]);
		expect(performance.now() - started).toBeGreaterThan(100); // it waited for the lock

		expect(await holder.exited).toBe(0);
		const { rows } = await web.client.execute('select count(*) as n from t');
		expect(Number(rows[0]!.n)).toBe(2);
		web.client.close();
	});

	test('foreign keys are enforced for concurrent queries', async () => {
		const { client, ready } = createDatabase({ url: `file:${join(dir, 'fk.db')}` });
		await ready;
		await client.execute('create table parent (id integer primary key)');
		await client.execute('create table child (parent_id integer references parent(id))');
		const results = await Promise.allSettled(
			Array.from({ length: 10 }, () => client.execute('insert into child values (999)'))
		);
		expect(results.every((r) => r.status === 'rejected')).toBe(true);
		client.close();
	});
});

test('credentials in a remote URL become a Basic auth header', () => {
	expect(splitBasicAuth('file:/data/hans.db')).toEqual({ url: 'file:/data/hans.db' });
	expect(splitBasicAuth('http://sqld:8080')).toEqual({ url: 'http://sqld:8080' });
	const { url, fetch } = splitBasicAuth('http://libsql:p%40ss@sqld:8080');
	expect(url).toBe('http://sqld:8080');
	expect(fetch).toBeFunction();
});

// Dokploy's libSQL service runs sqld behind HTTP Basic auth. Needs the sqld binary.
describe.skipIf(!Bun.which('sqld'))('sqld with Basic auth', () => {
	let dir: string;
	let server: ReturnType<typeof Bun.spawn>;
	const port = 18_000 + Math.floor(Math.random() * 1_000);

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'hans-sqld-'));
		server = Bun.spawn(
			['sqld', '--db-path', join(dir, 'db'), '--http-listen-addr', `127.0.0.1:${port}`],
			{
				env: { ...process.env, SQLD_HTTP_AUTH: `basic:${btoa('libsql:s3cret')}` },
				stdout: 'ignore',
				stderr: 'ignore'
			}
		);
		for (let i = 0; i < 100; i++) {
			if (
				await fetch(`http://127.0.0.1:${port}/health`).then(
					(r) => r.ok,
					() => false
				)
			)
				return;
			await Bun.sleep(100);
		}
		throw new Error('sqld did not start');
	});
	afterAll(async () => {
		server.kill();
		await server.exited;
		await rm(dir, { recursive: true, force: true });
	});

	test('migrations and queries run with credentials in the URL', async () => {
		const { db, client, ready } = createDatabase({
			url: `http://libsql:s3cret@127.0.0.1:${port}`
		});
		await ready;
		await runMigrations(db);
		const { rows } = await client.execute('select count(*) as n from jobs');
		expect(Number(rows[0]!.n)).toBe(0);
		client.close();
	});

	test('wrong credentials are rejected', async () => {
		const { ready, client } = createDatabase({ url: `http://libsql:wrong@127.0.0.1:${port}` });
		expect(ready).rejects.toThrow();
		await ready.catch(() => {});
		client.close();
	});
});
