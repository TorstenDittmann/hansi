import { expect, test } from 'bun:test';
import { createTestDatabase, schema, type Database } from '@hans/db';
import type { PriceCatalog } from '@hans/llm';
import { backfillMissingCosts } from './backfill-costs';

const catalog: PriceCatalog = {
	openai: { 'gpt-6.1-sol': { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 } },
	'amazon-bedrock': {}
};

test('prices stored calls that were missing a cost and updates their reviews', async () => {
	const db = await seed();
	await call(db, {
		id: 'bedrock',
		reviewId: 'review-1',
		provider: 'amazon-bedrock',
		model: 'global.openai.gpt-6.1-sol',
		inputTokens: 1_000_000,
		outputTokens: 100_000,
		cachedInputTokens: 500_000
	});
	await call(db, {
		id: 'priced',
		reviewId: 'review-1',
		provider: 'anthropic',
		model: 'claude',
		inputTokens: 10,
		outputTokens: 10,
		costUsd: 1.5
	});
	await call(db, {
		id: 'chat',
		provider: 'amazon-bedrock',
		model: 'us.openai.gpt-6.1-sol',
		inputTokens: 1_000_000,
		outputTokens: 0
	});
	await call(db, {
		id: 'unknown',
		reviewId: 'review-2',
		provider: 'openai-compatible',
		model: 'local',
		inputTokens: 1_000_000,
		outputTokens: 1_000_000
	});

	expect(await backfillMissingCosts(db, catalog)).toEqual({ calls: 2, reviews: 1, skipped: 1 });

	const calls = await db.select().from(schema.llmCalls);
	const cost = (id: string) => calls.find((row) => row.id === id)?.costUsd;
	// 500k uncached input at $2, 500k cache read at $0.10, 100k output at $10.
	expect(cost('bedrock')).toBeCloseTo(1 + 0.05 + 1);
	expect(cost('priced')).toBe(1.5);
	// Geographic profiles are the OpenAI rate plus 10%.
	expect(cost('chat')).toBeCloseTo(2.2);
	expect(cost('unknown')).toBeNull();

	const reviews = await db.select().from(schema.reviews);
	expect(reviews.find((row) => row.id === 'review-1')?.costUsd).toBeCloseTo(1.5 + 1 + 0.05 + 1);
	expect(reviews.find((row) => row.id === 'review-2')?.costUsd).toBe(99);

	expect(await backfillMissingCosts(db, catalog)).toEqual({ calls: 0, reviews: 0, skipped: 1 });
});

async function seed() {
	const { db } = await createTestDatabase();
	await db
		.insert(schema.organization)
		.values({ id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
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
	for (const review of [
		{ id: 'review-1', costUsd: 1.5 },
		{ id: 'review-2', costUsd: 99 }
	]) {
		await db.insert(schema.reviews).values({
			id: review.id,
			organizationId: 'org-1',
			repositoryId: 10,
			pullNumber: 1,
			headSha: 'abc',
			status: 'completed',
			trigger: 'opened',
			costUsd: review.costUsd
		});
	}
	return db;
}

async function call(
	db: Database,
	input: {
		id: string;
		reviewId?: string;
		provider: string;
		model: string;
		inputTokens: number;
		outputTokens: number;
		cachedInputTokens?: number;
		costUsd?: number;
	}
) {
	await db.insert(schema.llmCalls).values({
		id: input.id,
		reviewId: input.reviewId ?? null,
		organizationId: 'org-1',
		role: input.reviewId ? 'review' : 'chat',
		provider: input.provider,
		model: input.model,
		inputTokens: input.inputTokens,
		outputTokens: input.outputTokens,
		cachedInputTokens: input.cachedInputTokens ?? 0,
		costUsd: input.costUsd ?? null,
		durationMs: 10
	});
}
