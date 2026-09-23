// Container entrypoint: applies migrations once, then starts the web server, the worker, or both.
// In `all` mode, if either process exits the container exits, so the orchestrator restarts it.
import { createDatabase, runMigrations } from '@hans/db';

const mode = process.env.HANS_MODE ?? 'all';
if (!['all', 'web', 'worker'].includes(mode)) {
	console.error(`Unknown HANS_MODE "${mode}", expected all, web, or worker`);
	process.exit(1);
}

if (mode !== 'worker' && process.env.HANS_SKIP_MIGRATIONS !== 'true') {
	const { db, client, ready } = createDatabase({
		url: process.env.DATABASE_URL ?? 'file:/data/hans.db',
		authToken: process.env.DATABASE_AUTH_TOKEN || undefined
	});
	await ready;
	await runMigrations(db);
	client.close();
	console.log('Migrations applied');
}

const commands: Record<string, string[]> = {
	web: ['bun', 'apps/web/build/index.js'],
	worker: ['bun', 'apps/worker/src/index.ts']
};
const names = mode === 'all' ? ['web', 'worker'] : [mode];
const children = names.map((name) =>
	Bun.spawn(commands[name]!, { stdio: ['inherit', 'inherit', 'inherit'], env: process.env })
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => children.forEach((child) => child.kill(signal)));
}

const exitCode = await Promise.race(children.map((child) => child.exited));
children.forEach((child) => child.kill('SIGTERM'));
await Promise.all(children.map((child) => child.exited));
process.exit(exitCode);
