import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Analytics } from '@hans/analytics';
import { createTestDatabase, schema } from '@hans/db';
import { createUsageRecorder } from './shared';

const realFetch = globalThis.fetch;
beforeAll(() => {
	// models.dev price catalog: $3 per million input tokens, $15 per million output tokens.
	globalThis.fetch = (async () =>
		Response.json({
			anthropic: { models: { 'claude-sonnet-5': { cost: { input: 3, output: 15 } } } }
		})) as unknown as typeof fetch;
});
afterAll(() => {
	globalThis.fetch = realFetch;
});

test('each model call is stored and reported to LLM analytics without prompts or outputs', async () => {
	const { db } = await createTestDatabase();
	await db
		.insert(schema.organization)
		.values({ id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
	const captured: Parameters<Analytics['capture']>[0][] = [];
	const analytics: Analytics = {
		capture: (event) => void captured.push(event),
		shutdown: async () => {}
	};

	const usage = await createUsageRecorder(
		{ db, analytics },
		{ organizationId: 'org-1', traceId: 'review-1' }
	);
	await usage.record({
		role: 'review',
		provider: 'anthropic',
		modelId: 'claude-sonnet-5',
		usage: { inputTokens: 1_000_000, outputTokens: 100_000 } as never,
		durationMs: 2_500
	});

	const [row] = await db.select().from(schema.llmCalls);
	expect(row).toMatchObject({ model: 'claude-sonnet-5', inputTokens: 1_000_000 });
	expect(captured).toEqual([
		{
			distinctId: 'organization:org-1',
			event: '$ai_generation',
			organizationId: 'org-1',
			properties: {
				$ai_trace_id: 'review-1',
				$ai_span_name: 'review',
				$ai_provider: 'anthropic',
				$ai_model: 'claude-sonnet-5',
				$ai_input_tokens: 1_000_000,
				$ai_output_tokens: 100_000,
				$ai_cache_read_input_tokens: 0,
				$ai_latency: 2.5,
				$ai_total_cost_usd: 4.5
			}
		}
	]);
	expect(usage.totals.costUsd).toBeCloseTo(4.5);
});

test('a failed model call is reported to LLM analytics as an error and not stored', async () => {
	const { db } = await createTestDatabase();
	const captured: Parameters<Analytics['capture']>[0][] = [];
	const analytics: Analytics = {
		capture: (event) => void captured.push(event),
		shutdown: async () => {}
	};
	const usage = await createUsageRecorder(
		{ db, analytics },
		{ organizationId: 'org-1', traceId: 'chat-1' }
	);

	usage.recordError({
		role: 'chat',
		provider: 'openai',
		modelId: 'gpt-5.5',
		durationMs: 800,
		message: 'Rate limit exceeded',
		status: 429
	});

	expect(await db.select().from(schema.llmCalls)).toEqual([]);
	expect(captured).toEqual([
		{
			distinctId: 'organization:org-1',
			event: '$ai_generation',
			organizationId: 'org-1',
			properties: {
				$ai_trace_id: 'chat-1',
				$ai_span_name: 'chat',
				$ai_provider: 'openai',
				$ai_model: 'gpt-5.5',
				$ai_latency: 0.8,
				$ai_is_error: true,
				$ai_error: 'Rate limit exceeded',
				$ai_http_status: 429
			}
		}
	]);
});
