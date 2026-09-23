import type { LanguageModelUsage } from 'ai';
import { providers, type ProviderId } from './providers';

/** USD per million tokens, as published by models.dev. */
export interface ModelPrice {
	input: number;
	output: number;
	cache_read?: number;
	cache_write?: number;
}

export type PriceCatalog = Record<string, Record<string, ModelPrice>>;

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cached: { catalog: PriceCatalog; fetchedAt: number } | undefined;

/** Fetches and caches the models.dev price catalog. Returns an empty catalog when offline. */
export async function loadPriceCatalog(fetchImpl: typeof fetch = fetch): Promise<PriceCatalog> {
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.catalog;

	try {
		const response = await fetchImpl(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
		const data = (await response.json()) as Record<
			string,
			{ models?: Record<string, { cost?: ModelPrice }> }
		>;

		const catalog: PriceCatalog = {};
		for (const [providerId, provider] of Object.entries(data)) {
			const prices: Record<string, ModelPrice> = {};
			for (const [modelId, model] of Object.entries(provider.models ?? {})) {
				if (model.cost) prices[modelId] = model.cost;
			}
			catalog[providerId] = prices;
		}
		cached = { catalog, fetchedAt: Date.now() };
		return catalog;
	} catch {
		return cached?.catalog ?? {};
	}
}

export function findPrice(
	catalog: PriceCatalog,
	provider: ProviderId,
	modelId: string
): ModelPrice | undefined {
	const providerId = providers[provider].modelsDevId;
	if (!providerId) return undefined;
	const prices = catalog[providerId];
	// Some providers report dated snapshots (`gpt-x-2026-01-01`) that models.dev lists undated.
	return prices?.[modelId] ?? prices?.[modelId.replace(/-\d{4}-?\d{2}-?\d{2}$/, '')];
}

/** Cost in USD, or `null` when the model has no known price. */
export function estimateCost(
	price: ModelPrice | undefined,
	usage: LanguageModelUsage
): number | null {
	if (!price) return null;
	const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
	const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
	const uncachedInput = Math.max((usage.inputTokens ?? 0) - cacheRead - cacheWrite, 0);

	const cost =
		uncachedInput * price.input +
		cacheRead * (price.cache_read ?? price.input) +
		cacheWrite * (price.cache_write ?? price.input) +
		(usage.outputTokens ?? 0) * price.output;
	return cost / 1_000_000;
}
