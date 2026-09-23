import { describe, expect, test } from 'bun:test';
import type { LanguageModelUsage } from 'ai';
import { decryptSecret, encryptSecret, keyHint } from './crypto';
import { listModels } from './models';
import { createLanguageModel, parseBedrockKey } from './providers';
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

describe('amazon bedrock', () => {
	test('parses Bedrock API keys and IAM access keys', () => {
		expect(parseBedrockKey(' bedrock-api-key-123 ')).toEqual({
			kind: 'api-key',
			apiKey: 'bedrock-api-key-123'
		});
		expect(parseBedrockKey('AKIAABCDEFGHIJKLMNOP:secret/Key+1')).toEqual({
			kind: 'iam',
			accessKeyId: 'AKIAABCDEFGHIJKLMNOP',
			secretAccessKey: 'secret/Key+1'
		});
		expect(parseBedrockKey('ASIAABCDEFGHIJKLMNOP:secret:session-token')).toMatchObject({
			kind: 'iam',
			sessionToken: 'session-token'
		});
	});

	const bedrockFetch = (seen: Request[]) =>
		(async (input: Request) => {
			seen.push(input);
			const url = new URL(input.url);
			return Response.json(
				url.pathname === '/inference-profiles'
					? { inferenceProfileSummaries: [{ inferenceProfileId: 'us.anthropic.claude-x' }] }
					: { modelSummaries: [{ modelId: 'amazon.nova-pro-v1:0', modelName: 'Nova Pro' }] }
			);
		}) as unknown as typeof fetch;

	test('lists inference profiles, then foundation models, with a bearer API key', async () => {
		const seen: Request[] = [];
		const models = await listModels(
			{ provider: 'amazon-bedrock', apiKey: 'bedrock-key', region: 'eu-central-1' },
			bedrockFetch(seen)
		);
		expect(models.map((m) => m.id)).toEqual(['us.anthropic.claude-x', 'amazon.nova-pro-v1:0']);
		expect(seen[0]?.url).toStartWith('https://bedrock.eu-central-1.amazonaws.com/');
		expect(seen[0]?.headers.get('authorization')).toBe('Bearer bedrock-key');
	});

	test('signs requests with SigV4 for IAM access keys', async () => {
		const seen: Request[] = [];
		await listModels(
			{ provider: 'amazon-bedrock', apiKey: 'AKIAABCDEFGHIJKLMNOP:secret', region: 'us-east-1' },
			bedrockFetch(seen)
		);
		expect(seen[0]?.headers.get('authorization')).toStartWith(
			'AWS4-HMAC-SHA256 Credential=AKIAABCDEFGHIJKLMNOP/'
		);
	});

	test('requires a region', async () => {
		await expect(listModels({ provider: 'amazon-bedrock', apiKey: 'k' })).rejects.toThrow('region');
		expect(() =>
			createLanguageModel({ provider: 'amazon-bedrock', apiKey: 'k' }, 'amazon.nova-pro-v1:0')
		).toThrow('region');
		const model = createLanguageModel(
			{ provider: 'amazon-bedrock', apiKey: 'k', region: 'us-east-1' },
			'amazon.nova-pro-v1:0'
		);
		expect(typeof model === 'object' && model.provider).toContain('bedrock');
	});
});
