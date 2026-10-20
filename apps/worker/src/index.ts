import { createAnalytics } from '@hans/analytics';
import { parseEnv } from '@hans/config';
import { createDatabase } from '@hans/db';
import { Queue, queues, type ChatJobPayload, type ReviewJobPayload } from '@hans/queue';
import pino from 'pino';
import { handleChatJob } from './chat-job';
import { handleReviewJob } from './review-job';
import { clearWorkdir, workdirProblem } from './shared';

const env = parseEnv(process.env);
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });

const { db, client, ready } = createDatabase({
	url: env.DATABASE_URL,
	authToken: env.DATABASE_AUTH_TOKEN
});
await ready;

const queue = new Queue(db);
const controller = new AbortController();
const analytics = createAnalytics(env.APP_URL);
const ctx = { db, env, logger, analytics };

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		if (controller.signal.aborted) {
			logger.warn({ signal }, 'second signal, exiting without waiting for in-flight jobs');
			process.exit(1);
		}
		logger.info({ signal }, 'shutting down after in-flight jobs finish (signal again to force)');
		controller.abort();
	});
}

const problem = await workdirProblem(env);
if (problem) {
	// Every job would fail the same way; stop here so the logs say why.
	logger.fatal(problem);
	process.exit(1);
}
await clearWorkdir(env);
// Workers sharing a work directory also clear what stopped workers left there.
const sweep = setInterval(() => void clearWorkdir(env, { ownJobs: false }), 60 * 60_000);
logger.info({ concurrency: env.WORKER_CONCURRENCY, workerId: queue.workerId }, 'worker started');

const onError = (error: unknown, job?: { id: string; queue: string }) =>
	job
		? logger.error({ err: error, jobId: job.id, queue: job.queue }, 'job failed')
		: logger.error({ err: error }, 'queue poll failed');

await Promise.all([
	queue.work<ReviewJobPayload>(queues.review, (job) => handleReviewJob(ctx, job), {
		concurrency: env.WORKER_CONCURRENCY,
		// Reviews take minutes; the heartbeat extends the lease while one runs.
		leaseMs: 120_000,
		signal: controller.signal,
		onError
	}),
	// Chat gets its own slots so a quick question never waits behind a long review.
	queue.work<ChatJobPayload>(queues.chat, (job) => handleChatJob(ctx, job), {
		concurrency: env.WORKER_CONCURRENCY,
		leaseMs: 120_000,
		signal: controller.signal,
		onError
	})
]);

clearInterval(sweep);
await analytics.shutdown();
client.close();
logger.info('worker stopped');
// Exit explicitly: under `bun --watch` (dev) the process otherwise keeps watching after the
// script ends, outlives `bun run dev` as an orphan, and restarts on the next file change.
process.exit(0);
