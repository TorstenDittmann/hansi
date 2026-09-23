import { describe, expect, test } from 'bun:test';
import type { LanguageModelUsage } from 'ai';
import { decryptSecret, encryptSecret, keyHint } from './crypto';
import { listModels } from './models';
import { estimateCost, findPrice } from './pricing';

const key = Buffer.alloc(32, 7).toString('base64');

describe('crypto', () => {
	test('round-trips a secret', async () => {
		const encrypted = await encryptSecret('sk-secret', key, 'cred-1');
		expect(encrypted.startsWith('v1.')).toBe(true);
		expect(encrypted).not.toContain('sk-secret');
		expect(await decryptSecret(encrypted, key, 'cred-1')).toBe('sk-secret');
	});

	test('rejects a ciphertext moved to another context', async () => {
		const encrypted = await encryptSecret('sk-secret', key, 'cred-1');
		await expect(decryptSecret(encrypted, key, 'cred-2')).rejects.toThrow();
	});

	test('keyHint only reveals the tail of long keys', () => {
		expect(keyHint('sk-abcdefghijkl')).toBe('ijkl');
		expect(keyHint('short')).toBe('');
	});
});

describe('pricing', () => {
	const usage = (input: number, output: number, cacheRead = 0) =>
		({
			inputTokens: input,
			outputTokens: output,
			totalTokens: input + output,
			inputTokenDetails: {
				noCacheTokens: input - cacheRead,
				cacheReadTokens: cacheRead,
				cacheWriteTokens: 0
			},
			outputTokenDetails: { textTokens: output, reasoningTokens: 0 }
		}) satisfies LanguageModelUsage;

	test('prices input, cached input and output tokens', () => {
		const price = { input: 3, output: 15, cache_read: 0.3 };
		expect(estimateCost(price, usage(1_000_000, 0))).toBeCloseTo(3);
		expect(estimateCost(price, usage(1_000_000, 1_000_000, 500_000))).toBeCloseTo(1.5 + 0.15 + 15);
	});

	test('returns null for unknown models', () => {
		expect(estimateCost(undefined, usage(10, 10))).toBeNull();
	});

	test('finds dated model snapshots', () => {
		const catalog = { openai: { 'gpt-x': { input: 1, output: 2 } } };
		expect(findPrice(catalog, 'openai', 'gpt-x-2026-01-01')).toEqual({ input: 1, output: 2 });
		expect(findPrice(catalog, 'openai-compatible', 'gpt-x')).toBeUndefined();
	});
});

describe('listModels', () => {
	test('sends provider-specific auth headers', async () => {
		let request: Request | undefined;
		const fetchImpl = (async (input: string, init?: RequestInit) => {
			request = new Request(input, init);
			return Response.json({ data: [{ id: 'b' }, { id: 'a', display_name: 'A' }] });
		}) as typeof fetch;

		const models = await listModels({ provider: 'anthropic', apiKey: 'k' }, fetchImpl);
		expect(request?.headers.get('x-api-key')).toBe('k');
		expect(models).toEqual([
			{ id: 'a', name: 'A' },
			{ id: 'b', name: undefined }
		]);
	});

	test('surfaces provider errors', async () => {
		const fetchImpl = (async () =>
			new Response('bad key', { status: 401 })) as unknown as typeof fetch;
		await expect(listModels({ provider: 'openai', apiKey: 'k' }, fetchImpl)).rejects.toThrow('401');
	});
});
