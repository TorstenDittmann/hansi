import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>['db'];

export interface DatabaseOptions {
	url: string;
	authToken?: string;
}

export function createDatabase({ url, authToken }: DatabaseOptions) {
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
