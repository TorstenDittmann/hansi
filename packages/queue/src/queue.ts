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
	 * At most one queued job exists per key: sending again replaces the queued job's payload
	 * and starts its attempt count over. A queued job is not claimed while another job with
	 * the same key is active.
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
	/** Called when a job throws, and with no job when polling or bookkeeping fails. */
	onError?: (error: unknown, job?: Job) => void;
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
				// The previous payload's failures belong to that payload. The replacement is new work.
				set: {
					payload: sql`excluded.payload`,
					runAt: sql`excluded.run_at`,
					maxAttempts: sql`excluded.max_attempts`,
					attempts: 0,
					lastError: null
				}
			})
			.returning({ id: jobs.id });
		return row!.id;
	}

	/** Claims the next runnable job, including jobs whose lease expired (crashed worker). */
	async claim<T = unknown>(queue: string, leaseMs = 60_000): Promise<Job<T> | null> {
		const now = this.now();
		const next = sql`
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
			limit 1`;
		// Every worker polls every queue each second. Looking before writing keeps an idle poll a
		// read, so polling does not compete with real writes for SQLite's single write lock.
		const [candidate] = await this.db.all<{ id: string }>(next);
		if (!candidate) return null;
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
			where id = (${next})
			returning id, queue, payload, attempts, max_attempts, singleton_key
		`);

		const row = rows[0];
		if (!row) return null;
		// A worker that dies mid-job never calls fail(), so a job that kills its worker would
		// otherwise be reclaimed forever. Once its attempts are used, it fails here instead.
		if (row.attempts > row.max_attempts) {
			await this.db
				.update(jobs)
				.set({
					status: 'failed',
					finishedAt: now,
					lastError: 'The worker stopped while running this job',
					lockedBy: null,
					lockedUntil: null
				})
				.where(and(eq(jobs.id, row.id), eq(jobs.lockedBy, this.workerId)));
			return null;
		}
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

		// A database error here must not end the process: it would take every in-flight job with it.
		const report = (error: unknown, job?: Job) => options.onError?.(error, job);
		const run = async (job: Job<T>) => {
			const heartbeat = setInterval(
				() => void this.heartbeat(job.id, leaseMs).catch((error: unknown) => report(error, job)),
				leaseMs / 3
			);
			try {
				let failure: unknown;
				try {
					await handler(job);
				} catch (error) {
					failure = error;
					report(error, job);
				}
				if (failure === undefined) await this.complete(job.id);
				else await this.fail(job, failure);
			} catch (error) {
				// The job's row could not be updated; its lease runs out and it is claimed again.
				report(error, job);
			} finally {
				clearInterval(heartbeat);
			}
		};

		while (!signal?.aborted) {
			if (inFlight.size < concurrency) {
				const job = await this.claim<T>(queue, leaseMs).catch((error: unknown) => {
					report(error);
					return null;
				});
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
