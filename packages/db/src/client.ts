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
	const url = resolveDatabaseUrl(options.url);
	const { authToken } = options;
	const isLocalFile = url.startsWith('file:');
	if (isLocalFile) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });

	const client = createClient({ url, authToken });
	const db = drizzle(client, { schema });

	// Local files are shared by the web and worker processes: WAL lets readers and the single
	// writer proceed concurrently, busy_timeout waits instead of failing on a locked database.
	const ready = (async () => {
		if (isLocalFile) {
			await client.execute('PRAGMA journal_mode = WAL');
			await client.execute('PRAGMA busy_timeout = 5000');
			await client.execute('PRAGMA synchronous = NORMAL');
		}
		await client.execute('PRAGMA foreign_keys = ON');
	})();

	return { db, client, ready };
}
