import { expect, test } from 'bun:test';
import { createTestDatabase, schema, type Database } from '@hans/db';
import { costSummary } from './costs';

const now = new Date('2026-09-15T12:00:00Z');

test('reviews this month include skipped reviews', async () => {
	const db = await seed();
	const summary = await costSummary(db, 'org-1', now);

	// Completed and skipped reviews created in September. Failed, superseded, queued, August,
	// and the other organization do not count.
	expect(summary.month.reviews).toBe(4);

	const api = summary.byRepository.find((row) => row.repository === 'acme/api');
	const docs = summary.byRepository.find((row) => row.repository === 'acme/docs');
	// Completed and skipped in the last 30 days. The failed review's spend is included; it is not a counted review.
	expect(api).toEqual({ repository: 'acme/api', cost: 3.75, reviews: 4 });
	expect(docs).toEqual({ repository: 'acme/docs', cost: 0, reviews: 1 });
});

async function seed() {
	const { db } = await createTestDatabase();
	await db.insert(schema.organization).values([
		{ id: 'org-1', name: 'Acme', slug: 'acme', createdAt: now },
		{ id: 'org-2', name: 'Other', slug: 'other', createdAt: now }
	]);
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-1',
		accountLogin: 'acme',
		accountType: 'Organization'
	});
	await db.insert(schema.repositories).values([
		{ id: 10, installationId: 1, fullName: 'acme/api', private: false, enabled: true },
		{ id: 11, installationId: 1, fullName: 'acme/docs', private: false, enabled: true }
	]);

	await review(db, {
		id: 'completed',
		status: 'completed',
		createdAt: utc(2026, 9, 2),
		costUsd: 1.5
	});
	await review(db, { id: 'skipped', status: 'skipped', createdAt: utc(2026, 9, 3) });
	await review(db, { id: 'failed', status: 'failed', createdAt: utc(2026, 9, 4), costUsd: 2 });
	await review(db, { id: 'superseded', status: 'superseded', createdAt: utc(2026, 9, 5) });
	await review(db, { id: 'queued', status: 'queued', createdAt: utc(2026, 9, 7) });
	await review(db, {
		id: 'skipped-with-call',
		status: 'skipped',
		createdAt: utc(2026, 9, 6),
		costUsd: 0.25
	});
	await review(db, { id: 'skipped-recent', status: 'skipped', createdAt: utc(2026, 8, 20) });
	await review(db, { id: 'skipped-old', status: 'skipped', createdAt: utc(2026, 8, 1) });
	await review(db, {
		id: 'docs-skipped',
		repositoryId: 11,
		status: 'skipped',
		createdAt: utc(2026, 9, 10)
	});
	await review(db, {
		id: 'other-org',
		organizationId: 'org-2',
		status: 'skipped',
		createdAt: utc(2026, 9, 2)
	});
	return db;
}

function utc(year: number, month: number, day: number) {
	return new Date(Date.UTC(year, month - 1, day));
}

async function review(
	db: Database,
	input: {
		id: string;
		organizationId?: string;
		repositoryId?: number;
		status: 'completed' | 'skipped' | 'failed' | 'superseded' | 'queued';
		createdAt: Date;
		costUsd?: number;
	}
) {
	await db.insert(schema.reviews).values({
		id: input.id,
		organizationId: input.organizationId ?? 'org-1',
		repositoryId: input.repositoryId ?? 10,
		pullNumber: 1,
		headSha: 'abc',
		status: input.status,
		trigger: 'opened',
		createdAt: input.createdAt
	});
	if (input.costUsd === undefined) return;
	await db.insert(schema.llmCalls).values({
		reviewId: input.id,
		organizationId: input.organizationId ?? 'org-1',
		role: 'review',
		provider: 'anthropic',
		model: 'claude',
		costUsd: input.costUsd,
		durationMs: 10,
		createdAt: input.createdAt
	});
}
