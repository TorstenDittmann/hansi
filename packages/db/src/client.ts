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

export function createDatabase(options: DatabaseOptions) {
	let url = resolveDatabaseUrl(options.url);
	const { authToken } = options;
	// sqld behind HTTP Basic auth (e.g. Dokploy's libSQL service): the client rejects `user:pass@`
	// in the URL, so move the credentials into a header.
	const credentials = url.match(/^\w+:\/\/([^@/]+)@/);
	if (credentials) url = url.replace(`${credentials[1]}@`, '');
	const basicAuth = credentials && `Basic ${btoa(decodeURIComponent(credentials[1]!))}`;
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
			: {
					url,
					authToken,
					fetch: basicAuth
						? (request: Request) => {
								request.headers.set('authorization', basicAuth);
								return fetch(request);
							}
						: undefined
				}
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
