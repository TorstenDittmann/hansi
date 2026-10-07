import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createTestDatabase, schema, type Database } from '@hans/db';
import { Queue, chatJobFromComment } from '@hans/queue';
import { enqueueChat, enqueueReview, retryFailedReview, reviewJobPayload } from './jobs';

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

test('a review-comment webhook job keeps the commenter association', async () => {
	const db = await setup();
	const queue = new Queue(db);
	await enqueueChat(
		queue,
		chatJobFromComment({
			organizationId: 'org-a',
			repositoryId: 10,
			pullNumber: 14168,
			kind: 'review',
			rootCommentId: 4195124056,
			comment: {
				id: 4203558030,
				html_url: 'https://github.com/appwrite/appwrite/pull/14168#discussion_r4203558030',
				author_association: 'MEMBER',
				user: { login: 'eldadfux' }
			}
		})
	);

	const [job] = await db.select().from(schema.jobs);
	expect(job).toMatchObject({
		queue: 'chat',
		maxAttempts: 2,
		payload: {
			organizationId: 'org-a',
			repositoryId: 10,
			pullNumber: 14168,
			commentId: 4203558030,
			kind: 'review',
			rootCommentId: 4195124056,
			author: 'eldadfux',
			authorAssociation: 'MEMBER',
			commentUrl: 'https://github.com/appwrite/appwrite/pull/14168#discussion_r4203558030'
		}
	});
});

test('an untrusted commenter is stored as given, not promoted', () => {
	expect(
		chatJobFromComment({
			organizationId: 'org-a',
			repositoryId: 10,
			pullNumber: 7,
			kind: 'issue',
			comment: {
				id: 3,
				html_url: 'https://github.com/acme/web/pull/7#issuecomment-3',
				author_association: 'CONTRIBUTOR',
				user: { login: 'outsider' }
			}
		}).authorAssociation
	).toBe('CONTRIBUTOR');
});

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

test('retry starts over when the waiting job already used attempts', async () => {
	const db = await setup();
	const queue = new Queue(db);
	await addReview(db, { id: 'failed-1', status: 'failed' });
	await addReview(db, { id: 'waiting', status: 'queued' });
	await db.insert(schema.jobs).values({
		queue: 'review',
		payload: { reviewId: 'waiting' },
		status: 'queued',
		singletonKey: '10:7',
		attempts: 2,
		maxAttempts: 3,
		lastError: 'Bedrock is unable to process your request.',
		runAt: now.getTime(),
		createdAt: now.getTime()
	});

	const result = await retryFailedReview(db, queue, 'org-a', 'failed-1');
	expect(result.ok).toBe(true);
	if (!result.ok) return;

	const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.status, 'queued'));
	expect(job).toMatchObject({
		attempts: 0,
		maxAttempts: 3,
		lastError: null,
		payload: { reviewId: result.reviewId }
	});
});

test("a mention's comment id is carried on the job payload", async () => {
	const db = await setup();
	const queue = new Queue(db);

	const review = await enqueueReview(db, queue, {
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber: 7,
		headSha: '',
		trigger: 'mention',
		commentId: 6032071535,
		commentKind: 'issue'
	});

	const [row] = await db.select().from(schema.reviews).where(eq(schema.reviews.id, review.id));
	expect(row).toMatchObject({ trigger: 'mention', headSha: '', status: 'queued' });

	const jobs = await db.select().from(schema.jobs);
	expect(jobs).toHaveLength(1);
	expect(jobs[0]?.payload).toEqual({
		reviewId: review.id,
		commentId: 6032071535,
		commentKind: 'issue'
	});
});

test('a review comment mention records its kind, and a push does not', () => {
	expect(reviewJobPayload('rev-1', { commentId: 12, commentKind: 'review' })).toEqual({
		reviewId: 'rev-1',
		commentId: 12,
		commentKind: 'review'
	});
	expect(reviewJobPayload('rev-1')).toEqual({ reviewId: 'rev-1' });
});

test('a later mention replaces the comment id on the waiting job', async () => {
	const db = await setup();
	const queue = new Queue(db);
	await enqueueReview(db, queue, {
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber: 7,
		headSha: '',
		trigger: 'mention',
		commentId: 1,
		commentKind: 'issue'
	});
	const latest = await enqueueReview(db, queue, {
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber: 7,
		headSha: '',
		trigger: 'mention',
		commentId: 2,
		commentKind: 'review'
	});

	const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.status, 'queued'));
	expect(jobs).toHaveLength(1);
	expect(jobs[0]?.payload).toEqual({
		reviewId: latest.id,
		commentId: 2,
		commentKind: 'review'
	});
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
