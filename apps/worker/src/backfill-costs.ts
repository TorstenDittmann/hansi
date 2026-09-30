import { schema, type Database } from '@hans/db';
import {
	estimateCost,
	findPrice,
	providerIds,
	type PriceCatalog,
	type ProviderId
} from '@hans/llm';
import { and, eq, isNull, sql } from 'drizzle-orm';

/**
 * Fills in `llm_calls.cost_usd` for calls that were stored before a price was known, then
 * recomputes `reviews.cost_usd` for the reviews those calls belong to. Cache writes are not
 * stored on the call, so they are priced as ordinary input.
 */
export async function backfillMissingCosts(
	db: Database,
	catalog: PriceCatalog
): Promise<{ calls: number; reviews: number }> {
	const missing = await db
		.select({
			id: schema.llmCalls.id,
			reviewId: schema.llmCalls.reviewId,
			provider: schema.llmCalls.provider,
			model: schema.llmCalls.model,
			inputTokens: schema.llmCalls.inputTokens,
			outputTokens: schema.llmCalls.outputTokens,
			cachedInputTokens: schema.llmCalls.cachedInputTokens
		})
		.from(schema.llmCalls)
		.where(isNull(schema.llmCalls.costUsd));

	const reviewIds = new Set<string>();
	let calls = 0;
	await db.transaction(async (tx) => {
		for (const call of missing) {
			const cost = costOfStoredCall(catalog, call);
			if (cost == null) continue;
			const updated = await tx
				.update(schema.llmCalls)
				.set({ costUsd: cost })
				.where(and(eq(schema.llmCalls.id, call.id), isNull(schema.llmCalls.costUsd)))
				.returning({ id: schema.llmCalls.id });
			if (updated.length === 0) continue;
			calls += 1;
			if (call.reviewId) reviewIds.add(call.reviewId);
		}

		for (const reviewId of reviewIds) {
			const [sum] = await tx
				.select({ cost: sql<number>`coalesce(sum(${schema.llmCalls.costUsd}), 0)` })
				.from(schema.llmCalls)
				.where(eq(schema.llmCalls.reviewId, reviewId));
			await tx
				.update(schema.reviews)
				.set({ costUsd: Number(sum?.cost ?? 0) })
				.where(eq(schema.reviews.id, reviewId));
		}
	});

	return { calls, reviews: reviewIds.size };
}

function costOfStoredCall(
	catalog: PriceCatalog,
	call: {
		provider: string;
		model: string;
		inputTokens: number;
		outputTokens: number;
		cachedInputTokens: number;
	}
): number | null {
	if (!isProviderId(call.provider)) return null;
	const cacheRead = call.cachedInputTokens;
	return estimateCost(findPrice(catalog, call.provider, call.model), {
		inputTokens: call.inputTokens,
		outputTokens: call.outputTokens,
		totalTokens: call.inputTokens + call.outputTokens,
		inputTokenDetails: {
			noCacheTokens: Math.max(call.inputTokens - cacheRead, 0),
			cacheReadTokens: cacheRead,
			cacheWriteTokens: 0
		},
		outputTokenDetails: { textTokens: call.outputTokens, reasoningTokens: 0 }
	});
}

function isProviderId(provider: string): provider is ProviderId {
	return (providerIds as readonly string[]).includes(provider);
}
