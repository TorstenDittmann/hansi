import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Analytics } from '@hans/analytics';
import { createTestDatabase, schema } from '@hans/db';
import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '@hans/config';
import {
	clearWorkdir,
	workdirProblem,
	createUsageRecorder,
	reviewDetailsUrl,
	reviewDetailsUrlFor,
	reviewTimings
} from './shared';

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
		reasoningEffort: 'high',
		usage: {
			inputTokens: 1_000_000,
			outputTokens: 100_000,
			outputTokenDetails: { reasoningTokens: 40_000 }
		} as never,
		durationMs: 2_500
	});

	const [row] = await db.select().from(schema.llmCalls);
	expect(row).toMatchObject({
		model: 'claude-sonnet-5',
		inputTokens: 1_000_000,
		reasoningTokens: 40_000,
		reasoningEffort: 'high'
	});
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

test('review links include the organization slug', async () => {
	expect(reviewDetailsUrl('https://hans.example/', 'acme', 'review-1')).toBe(
		'https://hans.example/app/acme/reviews/review-1'
	);
	const { db } = await createTestDatabase();
	await db
		.insert(schema.organization)
		.values({ id: 'org-1', name: 'Acme', slug: 'acme', createdAt: new Date() });
	expect(await reviewDetailsUrlFor(db, 'https://hans.example', 'org-1', 'review-1')).toBe(
		'https://hans.example/app/acme/reviews/review-1'
	);
	expect(
		await reviewDetailsUrlFor(db, 'https://hans.example', 'missing', 'review-1')
	).toBeUndefined();
});

test('review timings split queue wait from run time', () => {
	const at = (ms: number) => new Date(1_000_000 + ms);
	expect(reviewTimings({ createdAt: at(0), startedAt: at(4_000), finishedAt: at(94_000) })).toEqual(
		{
			queueMs: 4_000,
			durationMs: 90_000,
			totalMs: 94_000
		}
	);
	expect(reviewTimings({ createdAt: at(0), startedAt: null, finishedAt: at(2_000) })).toEqual({
		totalMs: 2_000
	});
	expect(reviewTimings({ createdAt: at(0), startedAt: at(1_000), finishedAt: null })).toEqual({});
});

test("clearing the work directory removes this worker's leftovers, read-only parts included", async () => {
	const root = await mkdtemp(join(tmpdir(), 'hans-workdir-'));
	const locked = join(root, 'job-a-123.sandbox', 'workspace', 'cache');
	await mkdir(locked, { recursive: true });
	await writeFile(join(locked, 'module.go'), 'package x');
	await chmod(locked, 0o555);
	await mkdir(join(root, 'job-a-123'));
	await mkdir(join(root, 'keep'));

	await clearWorkdir({ WORKER_WORKDIR: root } as Env, { instance: 'a' });

	expect(await readdir(root)).toEqual(['keep']);
});

test("another worker's job directories are only removed once they are stale", async () => {
	const root = await mkdtemp(join(tmpdir(), 'hans-workdir-'));
	await mkdir(join(root, 'job-a-1'));
	await mkdir(join(root, 'job-b-1'));
	const env = { WORKER_WORKDIR: root } as Env;

	await clearWorkdir(env, { ownJobs: false, instance: 'a' });
	expect((await readdir(root)).sort()).toEqual(['job-a-1', 'job-b-1']);

	await clearWorkdir(env, { instance: 'a' });
	expect(await readdir(root)).toEqual(['job-b-1']);

	await clearWorkdir(env, { instance: 'a', now: Date.now() + 7 * 60 * 60_000 });
	expect(await readdir(root)).toEqual([]);
});

test('a writable work directory is fine, and is created when missing', async () => {
	const root = join(await mkdtemp(join(tmpdir(), 'hans-workdir-')), 'nested');
	expect(await workdirProblem({ WORKER_WORKDIR: root } as Env)).toBeNull();
	expect(await readdir(root)).toEqual([]);
});
