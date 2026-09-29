import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createTestDatabase, schema, type Database } from '@hans/db';
import { Queue } from '@hans/queue';
import { enqueueReview, retryFailedReview } from './jobs';

const now = new Date('2026-09-01T00:00:00Z');

async function setup() {
	const { db } = await createTestDatabase();
	await db.insert(schema.organization).values({
		id: 'org-a',
		name: 'A',
		slug: 'a',
		createdAt: now
	});
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-a',
		accountLogin: 'acme',
		accountType: 'Organization'
	});
	await db.insert(schema.repositories).values({
		id: 10,
		installationId: 1,
		fullName: 'acme/web',
		private: false,
		enabled: true
	});
	return db;
}

async function addReview(
	db: Database,
	input: { id: string; status: 'failed' | 'completed' | 'queued'; pullNumber?: number }
) {
	await db.insert(schema.reviews).values({
		id: input.id,
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber: input.pullNumber ?? 7,
		headSha: 'abc123',
		status: input.status,
		trigger: 'opened',
		error: input.status === 'failed' ? 'Bedrock is unable to process your request.' : null,
		createdAt: now
	});
}

test('retry queues a new review and leaves the failed one in place', async () => {
	const db = await setup();
	const queue = new Queue(db);
	await addReview(db, { id: 'failed-1', status: 'failed' });

	const result = await retryFailedReview(db, queue, 'org-a', 'failed-1');
	expect(result.ok).toBe(true);
	if (!result.ok) return;

	const [failed] = await db.select().from(schema.reviews).where(eq(schema.reviews.id, 'failed-1'));
	expect(failed?.status).toBe('failed');
	expect(failed?.error).toContain('Bedrock');

	const [retry] = await db
		.select()
		.from(schema.reviews)
		.where(eq(schema.reviews.id, result.reviewId));
	expect(retry).toMatchObject({
		status: 'queued',
		trigger: 'manual',
		pullNumber: 7,
		headSha: 'abc123',
		organizationId: 'org-a'
	});

	const jobs = await db.select().from(schema.jobs);
	expect(jobs).toHaveLength(1);
	expect(jobs[0]).toMatchObject({
		queue: 'review',
		status: 'queued',
		payload: { reviewId: result.reviewId },
		singletonKey: '10:7'
	});
});

test('retry replaces a review already waiting for the same pull request', async () => {
	const db = await setup();
	const queue = new Queue(db);
	await addReview(db, { id: 'failed-1', status: 'failed' });
	const waiting = await enqueueReview(db, queue, {
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber: 7,
		headSha: 'older',
		trigger: 'opened'
	});

	const result = await retryFailedReview(db, queue, 'org-a', 'failed-1');
	expect(result.ok).toBe(true);
	if (!result.ok) return;

	const [previous] = await db
		.select()
		.from(schema.reviews)
		.where(eq(schema.reviews.id, waiting.id));
	expect(previous?.status).toBe('superseded');

	const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.status, 'queued'));
	expect(jobs).toHaveLength(1);
	expect(jobs[0]?.payload).toEqual({ reviewId: result.reviewId });
});

test('retry refuses a review that is not failed, and one from another organization', async () => {
	const db = await setup();
	const queue = new Queue(db);
	await addReview(db, { id: 'done', status: 'completed' });

	expect(await retryFailedReview(db, queue, 'org-a', 'done')).toEqual({
		ok: false,
		reason: 'not-failed'
	});
	expect(await retryFailedReview(db, queue, 'org-a', 'missing')).toEqual({
		ok: false,
		reason: 'not-found'
	});
	await addReview(db, { id: 'failed-1', status: 'failed' });
	expect(await retryFailedReview(db, queue, 'org-b', 'failed-1')).toEqual({
		ok: false,
		reason: 'not-found'
	});
	expect(await db.select().from(schema.jobs)).toHaveLength(0);
});
