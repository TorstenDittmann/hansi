import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createTestDatabase, schema, type Database } from '@hans/db';
import { Queue } from './queue';

let db: Database;
let clock: number;
const now = () => clock;

beforeEach(async () => {
	({ db } = await createTestDatabase());
	clock = 1_000_000;
});

const queue = (workerId = 'w1') => new Queue(db, { workerId, now, backoffMs: () => 5_000 });

describe('Queue', () => {
	test('claims each job once', async () => {
		const q = queue();
		await q.send('review', { n: 1 });
		const first = await q.claim<{ n: number }>('review');
		expect(first?.payload).toEqual({ n: 1 });
		expect(first?.attempts).toBe(1);
		expect(await queue('w2').claim('review')).toBeNull();
	});

	test('respects runAt', async () => {
		const q = queue();
		await q.send('review', {}, { runAt: clock + 1_000 });
		expect(await q.claim('review')).toBeNull();
		clock += 1_000;
		expect(await q.claim('review')).not.toBeNull();
	});

	test('singleton key replaces the queued payload', async () => {
		const q = queue();
		const a = await q.send('review', { sha: 'a' }, { singletonKey: 'repo:1' });
		const b = await q.send('review', { sha: 'b' }, { singletonKey: 'repo:1' });
		expect(b).toBe(a);
		expect((await q.claim('review'))?.payload).toEqual({ sha: 'b' });
	});

	test('singleton key holds queued jobs while one is active', async () => {
		const q = queue();
		await q.send('review', { sha: 'a' }, { singletonKey: 'repo:1' });
		const active = await q.claim('review');
		await q.send('review', { sha: 'b' }, { singletonKey: 'repo:1' });
		expect(await queue('w2').claim('review')).toBeNull();

		await q.complete(active!.id);
		expect((await queue('w2').claim('review'))?.payload).toEqual({ sha: 'b' });
	});

	test('retries with backoff, then fails', async () => {
		const q = queue();
		await q.send('review', {}, { maxAttempts: 2 });

		await q.fail((await q.claim('review'))!, new Error('boom'));
		expect(await q.claim('review')).toBeNull();
		clock += 5_000;

		const retry = await q.claim('review');
		expect(retry?.attempts).toBe(2);
		await q.fail(retry!, new Error('boom again'));

		const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, retry!.id));
		expect(row?.status).toBe('failed');
		expect(row?.lastError).toContain('boom again');
	});

	test('reclaims jobs whose lease expired', async () => {
		await queue('crashed').send('review', {});
		await queue('crashed').claim('review', 10_000);
		expect(await queue('w2').claim('review')).toBeNull();
		clock += 10_001;
		expect((await queue('w2').claim('review'))?.attempts).toBe(2);
	});

	test('work() processes jobs and stops on abort', async () => {
		const q = new Queue(db);
		await q.send('review', { n: 1 });
		await q.send('review', { n: 2 });

		const seen: number[] = [];
		const controller = new AbortController();
		await q.work<{ n: number }>(
			'review',
			async (job) => {
				seen.push(job.payload.n);
				if (seen.length === 2) controller.abort();
			},
			{ concurrency: 2, pollIntervalMs: 5, signal: controller.signal }
		);

		expect(seen.sort()).toEqual([1, 2]);
		const rows = await db.select().from(schema.jobs);
		expect(rows.every((row) => row.status === 'completed')).toBe(true);
	});
});
