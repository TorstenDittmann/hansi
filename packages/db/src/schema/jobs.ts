import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const jobStatuses = ['queued', 'active', 'completed', 'failed'] as const;
export type JobStatus = (typeof jobStatuses)[number];

/** Backing table for @hans/queue. Timestamps are epoch milliseconds. */
export const jobs = sqliteTable(
	'jobs',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		queue: text('queue').notNull(),
		payload: text('payload', { mode: 'json' }).notNull(),
		status: text('status', { enum: jobStatuses }).notNull().default('queued'),
		/** At most one queued job per key; queued jobs wait while one with the same key is active. */
		singletonKey: text('singleton_key'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(3),
		runAt: integer('run_at').notNull(),
		lockedBy: text('locked_by'),
		lockedUntil: integer('locked_until'),
		lastError: text('last_error'),
		createdAt: integer('created_at').notNull(),
		finishedAt: integer('finished_at')
	},
	(t) => [
		index('jobs_claim_idx').on(t.queue, t.status, t.runAt),
		uniqueIndex('jobs_queued_singleton_idx')
			.on(t.queue, t.singletonKey)
			.where(sql`${t.status} = 'queued' and ${t.singletonKey} is not null`)
	]
);
