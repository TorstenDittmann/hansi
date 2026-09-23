import { parseEnv } from '@hans/config';
import { createDatabase } from '@hans/db';
import { Queue } from '@hans/queue';
import pino from 'pino';
import { handleReviewJob, type ReviewJobPayload } from './review-job';

const env = parseEnv(process.env);
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });

const { db, client, ready } = createDatabase({
	url: env.DATABASE_URL,
	authToken: env.DATABASE_AUTH_TOKEN
});
await ready;

const queue = new Queue(db);
const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		logger.info({ signal }, 'shutting down after in-flight reviews finish');
		controller.abort();
	});
}

logger.info({ concurrency: env.WORKER_CONCURRENCY, workerId: queue.workerId }, 'worker started');

await queue.work<ReviewJobPayload>('review', (job) => handleReviewJob({ db, env, logger }, job), {
	concurrency: env.WORKER_CONCURRENCY,
	// Reviews take minutes; the heartbeat extends the lease while one runs.
	leaseMs: 120_000,
	signal: controller.signal,
	onError: (error, job) => logger.error({ err: error, jobId: job.id }, 'review job failed')
});

client.close();
logger.info('worker stopped');
