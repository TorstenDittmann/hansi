import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>['db'];

export interface DatabaseOptions {
	url: string;
	authToken?: string;
}

/** The nearest ancestor directory whose package.json declares workspaces (the repository root). */
export function findWorkspaceRoot(from: string): string | null {
	for (let dir = resolve(from); ; dir = dirname(dir)) {
		const manifest = join(dir, 'package.json');
		if (existsSync(manifest)) {
			try {
				if (JSON.parse(readFileSync(manifest, 'utf8')).workspaces) return dir;
			} catch {
				// Unreadable manifest: keep looking upwards.
			}
		}
		if (dirname(dir) === dir) return null;
	}
}

/**
 * Makes relative `file:` URLs relative to the repository root instead of the working directory,
 * so web (apps/web), worker (apps/worker), and migrations (packages/db) share one database file.
 */
export function resolveDatabaseUrl(url: string, cwd = process.cwd()): string {
	if (!url.startsWith('file:')) return url;
	const path = url.slice('file:'.length);
	if (path === ':memory:' || isAbsolute(path)) return url;
	return `file:${resolve(findWorkspaceRoot(cwd) ?? cwd, path)}`;
}

/**
 * sqld can require HTTP Basic auth (e.g. Dokploy's libSQL service), which the client rejects in
 * the URL. Take the credentials out of `http://user:pass@host` and send them as a header instead.
 */
export function splitBasicAuth(url: string): { url: string; fetch?: typeof fetch } {
	if (!/^(https?|libsql):/.test(url)) return { url };
	const parsed = new URL(url);
	if (!parsed.username) return { url };
	const credentials = btoa(
		`${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
	);
	parsed.username = '';
	parsed.password = '';
	const withAuth = ((input: string | URL | Request, init?: RequestInit) => {
		const request =
			input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
		request.headers.set('authorization', `Basic ${credentials}`);
		return fetch(request);
	}) as typeof fetch;
	return { url: parsed.toString().replace(/\/$/, ''), fetch: withAuth };
}

export function createDatabase(options: DatabaseOptions) {
	const { authToken } = options;
	const { url, fetch: basicAuthFetch } = splitBasicAuth(resolveDatabaseUrl(options.url));
	const isLocalFile = url.startsWith('file:');
	if (isLocalFile) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });

	// Local files are shared by the web and worker processes. `timeout` makes every connection
	// wait for a lock instead of failing with SQLITE_BUSY (the client's default is to fail
	// immediately). One connection per process: SQLite has a single writer anyway, and the local
	// driver blocks the thread while it waits for a lock, so a second in-process connection
	// waiting on the first one's transaction would stall the whole process until the timeout.
	const client = createClient(
		isLocalFile
			? { url, authToken, timeout: 5_000, concurrency: 1 }
			: { url, authToken, fetch: basicAuthFetch }
	);
	const db = drizzle(client, { schema });

	const ready = (async () => {
		if (isLocalFile) {
			// WAL lets readers proceed while one process writes; it persists in the file.
			await client.execute('PRAGMA journal_mode = WAL');
			await client.execute('PRAGMA synchronous = NORMAL');
		}
		await client.execute('PRAGMA foreign_keys = ON');
	})();

	return { db, client, ready };
}
