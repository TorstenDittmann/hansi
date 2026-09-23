import { and, eq, sql } from 'drizzle-orm';
import { schema, type Database } from '@hans/db';

const { jobs } = schema;

export type Job<T = unknown> = {
	id: string;
	queue: string;
	payload: T;
	attempts: number;
	maxAttempts: number;
	singletonKey: string | null;
};

export interface SendOptions {
	/**
	 * At most one queued job exists per key: sending again replaces the queued job's payload.
	 * A queued job is not claimed while another job with the same key is active.
	 */
	singletonKey?: string;
	runAt?: number;
	maxAttempts?: number;
}

export interface WorkOptions {
	concurrency?: number;
	pollIntervalMs?: number;
	leaseMs?: number;
	signal?: AbortSignal;
	onError?: (error: unknown, job: Job) => void;
}

export interface QueueOptions {
	workerId?: string;
	now?: () => number;
	/** Delay before retry attempt `n` (1-based). Defaults to exponential backoff from 10s, capped at 10min. */
	backoffMs?: (attempt: number) => number;
}

const defaultBackoff = (attempt: number) => Math.min(10_000 * 2 ** (attempt - 1), 600_000);

/**
 * Durable job queue backed by the `jobs` table.
 *
 * Claiming is a single `UPDATE … RETURNING` statement. SQLite serializes writers, so two
 * workers can never claim the same job, whether they share a local file or talk to sqld.
 */
export class Queue {
	readonly workerId: string;
	private readonly now: () => number;
	private readonly backoffMs: (attempt: number) => number;

	constructor(
		private readonly db: Database,
		options: QueueOptions = {}
	) {
		this.workerId = options.workerId ?? `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
		this.now = options.now ?? Date.now;
		this.backoffMs = options.backoffMs ?? defaultBackoff;
	}

	async send<T>(queue: string, payload: T, options: SendOptions = {}): Promise<string> {
		const now = this.now();
		const values = {
			queue,
			payload,
			singletonKey: options.singletonKey ?? null,
			maxAttempts: options.maxAttempts ?? 3,
			runAt: options.runAt ?? now,
			createdAt: now
		};

		if (!options.singletonKey) {
			const [row] = await this.db.insert(jobs).values(values).returning({ id: jobs.id });
			return row!.id;
		}

		const [row] = await this.db
			.insert(jobs)
			.values(values)
			.onConflictDoUpdate({
				target: [jobs.queue, jobs.singletonKey],
				targetWhere: sql`${jobs.status} = 'queued' and ${jobs.singletonKey} is not null`,
				set: { payload: sql`excluded.payload`, runAt: sql`excluded.run_at` }
			})
			.returning({ id: jobs.id });
		return row!.id;
	}

	/** Claims the next runnable job, including jobs whose lease expired (crashed worker). */
	async claim<T = unknown>(queue: string, leaseMs = 60_000): Promise<Job<T> | null> {
		const now = this.now();
		const rows = await this.db.all<{
			id: string;
			queue: string;
			payload: string;
			attempts: number;
			max_attempts: number;
			singleton_key: string | null;
		}>(sql`
			update jobs
			set status = 'active',
				attempts = attempts + 1,
				locked_by = ${this.workerId},
				locked_until = ${now + leaseMs}
			where id = (
				select j.id from jobs j
				where j.queue = ${queue}
					and (
						(j.status = 'queued' and j.run_at <= ${now})
						or (j.status = 'active' and j.locked_until < ${now})
					)
					and (
						j.singleton_key is null
						or not exists (
							select 1 from jobs other
							where other.queue = j.queue
								and other.singleton_key = j.singleton_key
								and other.id != j.id
								and other.status = 'active'
								and other.locked_until >= ${now}
						)
					)
				order by j.run_at
				limit 1
			)
			returning id, queue, payload, attempts, max_attempts, singleton_key
		`);

		const row = rows[0];
		if (!row) return null;
		return {
			id: row.id,
			queue: row.queue,
			payload: JSON.parse(row.payload) as T,
			attempts: row.attempts,
			maxAttempts: row.max_attempts,
			singletonKey: row.singleton_key
		};
	}

	async heartbeat(id: string, leaseMs = 60_000): Promise<void> {
		await this.db
			.update(jobs)
			.set({ lockedUntil: this.now() + leaseMs })
			.where(and(eq(jobs.id, id), eq(jobs.lockedBy, this.workerId), eq(jobs.status, 'active')));
	}

	async complete(id: string): Promise<void> {
		await this.db
			.update(jobs)
			.set({ status: 'completed', finishedAt: this.now(), lockedBy: null, lockedUntil: null })
			.where(and(eq(jobs.id, id), eq(jobs.lockedBy, this.workerId)));
	}

	/** Reschedules with backoff, or marks the job failed once attempts are exhausted. */
	async fail(job: Job, error: unknown): Promise<void> {
		const now = this.now();
		const exhausted = job.attempts >= job.maxAttempts;
		await this.db
			.update(jobs)
			.set({
				status: exhausted ? 'failed' : 'queued',
				runAt: exhausted ? undefined : now + this.backoffMs(job.attempts),
				finishedAt: exhausted ? now : null,
				lastError: error instanceof Error ? (error.stack ?? error.message) : String(error),
				lockedBy: null,
				lockedUntil: null
			})
			.where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, this.workerId)));
	}

	/**
	 * Polls `queue` and runs `handler` for each job with up to `concurrency` jobs in flight.
	 * Resolves once `signal` aborts and in-flight jobs have settled.
	 */
	async work<T>(
		queue: string,
		handler: (job: Job<T>) => Promise<void>,
		options: WorkOptions = {}
	): Promise<void> {
		const { concurrency = 1, pollIntervalMs = 1_000, leaseMs = 60_000, signal } = options;
		const inFlight = new Set<Promise<void>>();

		const run = async (job: Job<T>) => {
			const heartbeat = setInterval(() => void this.heartbeat(job.id, leaseMs), leaseMs / 3);
			try {
				await handler(job);
				await this.complete(job.id);
			} catch (error) {
				options.onError?.(error, job);
				await this.fail(job, error);
			} finally {
				clearInterval(heartbeat);
			}
		};

		while (!signal?.aborted) {
			if (inFlight.size < concurrency) {
				const job = await this.claim<T>(queue, leaseMs);
				if (job) {
					const promise = run(job).finally(() => inFlight.delete(promise));
					inFlight.add(promise);
					continue;
				}
			}
			await sleep(pollIntervalMs, signal);
		}

		await Promise.allSettled(inFlight);
	}
}

function sleep(ms: number, signal?: AbortSignal) {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});
}
