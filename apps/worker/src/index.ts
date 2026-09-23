import { parseEnv } from '@hans/config';
import { createDatabase } from '@hans/db';
import { Queue, queues, type ChatJobPayload, type ReviewJobPayload } from '@hans/queue';
import pino from 'pino';
import { handleChatJob } from './chat-job';
import { handleReviewJob } from './review-job';

const env = parseEnv(process.env);
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });

const { db, client, ready } = createDatabase({
	url: env.DATABASE_URL,
	authToken: env.DATABASE_AUTH_TOKEN
});
await ready;

const queue = new Queue(db);
const controller = new AbortController();
const ctx = { db, env, logger };

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		logger.info({ signal }, 'shutting down after in-flight jobs finish');
		controller.abort();
	});
}

logger.info({ concurrency: env.WORKER_CONCURRENCY, workerId: queue.workerId }, 'worker started');

const onError = (error: unknown, job: { id: string; queue: string }) =>
	logger.error({ err: error, jobId: job.id, queue: job.queue }, 'job failed');

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

client.close();
logger.info('worker stopped');
