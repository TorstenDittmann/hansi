// Container entrypoint: applies migrations once, then starts the web server, the worker, or both.
// In `all` mode, if either process crashes the container exits, so the orchestrator restarts it.
// A deploy is different: the worker finishes a review it already started. See supervise.ts.
import { createDatabase, runMigrations } from '@hans/db';
import { supervise, type SupervisedChild } from './supervise';

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
const children: SupervisedChild[] = names.map((name) => {
	const child = Bun.spawn(commands[name]!, {
		stdio: ['inherit', 'inherit', 'inherit'],
		env: process.env
	});
	return {
		drain: name === 'worker',
		kill: (signal) => child.kill(signal),
		exited: child.exited
	};
});

const exitCode = await supervise(children, (onSignal) => {
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => onSignal(signal));
	}
});
process.exit(exitCode);
