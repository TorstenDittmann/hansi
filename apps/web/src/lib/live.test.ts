import { describe, expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { eq } from 'drizzle-orm';
import { isLiveReviewStatus, pendingReviewMessage, REVIEW_STREAM_MS, streamReview } from './live';

test('only queued and running reviews are live', () => {
	expect(isLiveReviewStatus('queued')).toBe(true);
	expect(isLiveReviewStatus('running')).toBe(true);
	for (const status of ['completed', 'failed', 'skipped', 'superseded']) {
		expect(isLiveReviewStatus(status)).toBe(false);
	}
});

test('empty-state copy matches the in-flight status', () => {
	expect(pendingReviewMessage('queued')).toBe('Waiting in queue…');
	expect(pendingReviewMessage('running')).toBe('Review in progress…');
	expect(pendingReviewMessage('completed')).toBeNull();
	expect(pendingReviewMessage('superseded')).toBeNull();
});

test('the stream interval is two seconds', () => {
	expect(REVIEW_STREAM_MS).toBe(2_000);
});

describe('streamReview', () => {
	const immediate = async () => {};

	test('yields while running and stops after the first terminal snapshot', async () => {
		const statuses = ['running', 'running', 'completed', 'completed'];
		let reads = 0;
		const seen: string[] = [];
		for await (const review of streamReview(
			async () => ({ status: statuses[reads++] ?? 'completed' }),
			{ signal: new AbortController().signal, sleep: immediate }
		)) {
			seen.push(review.status);
		}
		expect(seen).toEqual(['running', 'running', 'completed']);
		expect(reads).toBe(3);
	});

	test('stops when the client disconnects', async () => {
		const controller = new AbortController();
		let reads = 0;
		const seen: string[] = [];
		for await (const review of streamReview(
			async () => {
				reads += 1;
				if (reads === 2) controller.abort();
				return { status: 'running' };
			},
			{ signal: controller.signal, sleep: immediate }
		)) {
			seen.push(review.status);
		}
		expect(seen).toEqual(['running', 'running']);
		expect(reads).toBe(2);
	});

	test('stops without yielding when the review is missing', async () => {
		const seen: string[] = [];
		for await (const review of streamReview(async () => null, {
			signal: new AbortController().signal,
			sleep: immediate
		})) {
			seen.push(review.status);
		}
		expect(seen).toEqual([]);
	});
});

describe('seeded review', () => {
	test('a running review streams until it is completed', async () => {
		const { db, id } = await seedReview('running');
		let reads = 0;
		const seen: string[] = [];
		for await (const review of streamReview(
			async () => {
				reads += 1;
				if (reads === 2) {
					await db
						.update(schema.reviews)
						.set({ status: 'completed', finishedAt: new Date() })
						.where(eq(schema.reviews.id, id));
				}
				const [row] = await db
					.select({ status: schema.reviews.status })
					.from(schema.reviews)
					.where(eq(schema.reviews.id, id));
				return row ?? null;
			},
			{ signal: new AbortController().signal, sleep: async () => {} }
		)) {
			seen.push(review.status);
		}
		expect(seen).toEqual(['running', 'completed']);
		expect(isLiveReviewStatus(seen.at(-1)!)).toBe(false);
	});

	test('superseded is terminal, same as completed', async () => {
		const { db, id } = await seedReview('queued');
		await db.update(schema.reviews).set({ status: 'superseded' }).where(eq(schema.reviews.id, id));
		const seen: string[] = [];
		for await (const review of streamReview(
			async () => {
				const [row] = await db
					.select({ status: schema.reviews.status })
					.from(schema.reviews)
					.where(eq(schema.reviews.id, id));
				return row ?? null;
			},
			{ signal: new AbortController().signal, sleep: async () => {} }
		)) {
			seen.push(review.status);
		}
		expect(seen).toEqual(['superseded']);
	});
});

async function seedReview(status: 'queued' | 'running') {
	const { db } = await createTestDatabase();
	const now = new Date();
	await db.insert(schema.organization).values({
		id: 'org-1',
		name: 'Acme',
		slug: 'acme',
		createdAt: now
	});
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-1',
		accountLogin: 'acme',
		accountType: 'Organization'
	});
	await db.insert(schema.repositories).values({
		id: 10,
		installationId: 1,
		fullName: 'acme/api',
		private: false,
		enabled: true
	});
	const id = 'rev-1';
	await db.insert(schema.reviews).values({
		id,
		organizationId: 'org-1',
		repositoryId: 10,
		pullNumber: 42,
		headSha: 'abc123',
		status,
		trigger: 'opened',
		startedAt: status === 'running' ? now : null
	});
	return { db, id };
}
