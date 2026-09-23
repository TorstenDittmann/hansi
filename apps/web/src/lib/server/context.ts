import { env as privateEnv } from '$env/dynamic/private';
import { parseEnv, type Env } from '@hans/config';
import { createDatabase, type Database } from '@hans/db';
import { loadGitHubAppCredentials, type GitHubAppCredentials } from '@hans/github';
import { Queue } from '@hans/queue';

interface Context {
	env: Env;
	db: Database;
	queue: Queue;
}

let context: Promise<Context> | undefined;

/** Process-wide singletons, created on first use so `vite build` never needs a database. */
export function getContext(): Promise<Context> {
	context ??= (async () => {
		const env = parseEnv(privateEnv);
		const { db, ready } = createDatabase({
			url: env.DATABASE_URL,
			authToken: env.DATABASE_AUTH_TOKEN
		});
		await ready;
		return { env, db, queue: new Queue(db) };
	})();
	return context;
}

let credentials: Promise<GitHubAppCredentials | null> | undefined;

export async function getGitHubCredentials(): Promise<GitHubAppCredentials | null> {
	const { db, env } = await getContext();
	credentials ??= loadGitHubAppCredentials(db, env).then((value) => {
		// Don't cache "not configured": setup may complete in this process at any time.
		if (!value) credentials = undefined;
		return value;
	});
	return credentials;
}

/** Call after the setup flow stores new credentials. */
export function invalidateGitHubCredentials() {
	credentials = undefined;
}
