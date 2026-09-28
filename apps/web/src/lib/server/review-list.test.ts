import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { countReviewList, listReviewedRepositoryNames, queryReviewList } from './review-list';

const now = new Date('2026-01-01T00:00:00Z');

async function setup() {
	const { db } = await createTestDatabase();
	await db.insert(schema.organization).values([
		{ id: 'org-a', name: 'A', slug: 'a', createdAt: now },
		{ id: 'org-b', name: 'B', slug: 'b', createdAt: now }
	]);
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-a',
		accountLogin: 'acme',
		accountType: 'Organization',
		createdAt: now,
		updatedAt: now
	});
	await db.insert(schema.repositories).values([
		{
			id: 10,
			installationId: 1,
			fullName: 'acme/web',
			private: false,
			enabled: true,
			createdAt: now,
			updatedAt: now
		},
		{
			id: 11,
			installationId: 1,
			fullName: 'acme/api',
			private: false,
			enabled: true,
			createdAt: now,
			updatedAt: now
		},
		{
			id: 12,
			installationId: 1,
			fullName: 'acme/100%',
			private: false,
			enabled: true,
			createdAt: now,
			updatedAt: now
		}
	]);
	return db;
}

async function addReview(
	db: Awaited<ReturnType<typeof setup>>,
	input: {
		id: string;
		pullNumber: number;
		repositoryId?: number;
		organizationId?: string;
		status?: 'completed' | 'failed' | 'running';
		createdAt: Date;
		verdict?: 'approve' | 'comment';
	}
) {
	await db.insert(schema.reviews).values({
		id: input.id,
		organizationId: input.organizationId ?? 'org-a',
		repositoryId: input.repositoryId ?? 10,
		pullNumber: input.pullNumber,
		headSha: 'abc',
		status: input.status ?? 'completed',
		trigger: 'opened',
		verdict: input.verdict ?? 'comment',
		tier: 'A',
		createdAt: input.createdAt
	});
}

test('lists an organization reviews newest first, with posted comment counts', async () => {
	const db = await setup();
	await addReview(db, { id: 'old', pullNumber: 1, createdAt: new Date('2026-01-01T00:00:00Z') });
	await addReview(db, { id: 'new', pullNumber: 2, createdAt: new Date('2026-01-03T00:00:00Z') });
	await addReview(db, {
		id: 'mid',
		pullNumber: 3,
		createdAt: new Date('2026-01-02T00:00:00Z'),
		status: 'failed',
		verdict: undefined
	});
	await addReview(db, {
		id: 'other-org',
		pullNumber: 9,
		organizationId: 'org-b',
		createdAt: new Date('2026-01-04T00:00:00Z')
	});
	await db.insert(schema.reviewFindings).values([
		{
			id: 'f1',
			reviewId: 'new',
			path: 'a.ts',
			startLine: 1,
			endLine: 2,
			severity: 'high',
			category: 'bug',
			title: 'Bug',
			body: 'A bug',
			status: 'posted'
		},
		{
			id: 'f2',
			reviewId: 'new',
			path: 'b.ts',
			startLine: 1,
			endLine: 1,
			severity: 'low',
			category: 'nit',
			title: 'Nit',
			body: 'Dropped',
			status: 'dropped'
		}
	]);

	const reviews = await queryReviewList(db, 'org-a');
	expect(reviews.map((review) => review.id)).toEqual(['new', 'mid', 'old']);
	expect(reviews[0]?.posted).toBe(1);
	expect(reviews[1]?.posted).toBe(0);
	expect(await countReviewList(db, 'org-a')).toBe(3);
	expect(await listReviewedRepositoryNames(db, 'org-a')).toEqual(['acme/web']);
	expect(await listReviewedRepositoryNames(db, 'org-b')).toEqual(['acme/web']);
});

test('pages with a stable order', async () => {
	const db = await setup();
	await addReview(db, { id: 'r1', pullNumber: 1, createdAt: new Date('2026-01-01T00:00:00Z') });
	await addReview(db, { id: 'r2', pullNumber: 2, createdAt: new Date('2026-01-01T00:00:00Z') });
	await addReview(db, { id: 'r3', pullNumber: 3, createdAt: new Date('2026-01-02T00:00:00Z') });

	expect((await queryReviewList(db, 'org-a', { limit: 2 })).map((review) => review.id)).toEqual([
		'r3',
		'r2'
	]);
	expect(
		(await queryReviewList(db, 'org-a', { limit: 2, offset: 2 })).map((review) => review.id)
	).toEqual(['r1']);
});

test('filters by status, repository, and pull request number', async () => {
	const db = await setup();
	await addReview(db, {
		id: 'web-12',
		pullNumber: 12,
		createdAt: new Date('2026-01-03T00:00:00Z')
	});
	await addReview(db, {
		id: 'web-120',
		pullNumber: 120,
		createdAt: new Date('2026-01-02T00:00:00Z')
	});
	await addReview(db, {
		id: 'api-12',
		pullNumber: 12,
		repositoryId: 11,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		status: 'failed'
	});
	await addReview(db, {
		id: 'percent',
		pullNumber: 4,
		repositoryId: 12,
		createdAt: new Date('2026-01-04T00:00:00Z')
	});

	expect(
		(await queryReviewList(db, 'org-a', { status: 'failed' })).map((review) => review.id)
	).toEqual(['api-12']);
	expect(
		(await queryReviewList(db, 'org-a', { repository: 'acme/web' })).map((review) => review.id)
	).toEqual(['web-12', 'web-120']);
	expect((await queryReviewList(db, 'org-a', { query: '#12' })).map((review) => review.id)).toEqual(
		['web-12', 'api-12']
	);
	expect(
		(await queryReviewList(db, 'org-a', { repository: 'acme/web', query: '12' })).map(
			(review) => review.id
		)
	).toEqual(['web-12']);
	expect(
		(await queryReviewList(db, 'org-a', { query: 'WEB' })).map((review) => review.repository)
	).toEqual(['acme/web', 'acme/web']);
	expect((await queryReviewList(db, 'org-a', { query: '%' })).map((review) => review.id)).toEqual([
		'percent'
	]);
	expect(await queryReviewList(db, 'org-a', { query: '_' })).toEqual([]);
	expect(await countReviewList(db, 'org-a', { repository: 'acme/api', status: 'failed' })).toBe(1);
	expect(await listReviewedRepositoryNames(db, 'org-a')).toEqual([
		'acme/100%',
		'acme/api',
		'acme/web'
	]);
});
