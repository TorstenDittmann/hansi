import { expect, test } from 'bun:test';
import { APICallError, RetryError } from 'ai';
import { callModel, type ModelCall, type ModelFailure } from './model-call';

const model = { provider: 'anthropic', modelId: 'claude-sonnet-5' };

function rateLimited() {
	const last = new APICallError({
		message: 'Rate limit exceeded',
		url: 'https://api.anthropic.com/v1/messages',
		requestBodyValues: {},
		statusCode: 429
	});
	return new RetryError({
		message: 'Failed after 3 attempts',
		reason: 'maxRetriesExceeded',
		errors: [last]
	});
}

test('reports usage when a call finishes', async () => {
	const calls: ModelCall[] = [];
	const result = await callModel(
		'review',
		model,
		{ onModelCall: (c) => void calls.push(c) },
		async () => ({
			usage: { inputTokens: 10, outputTokens: 2 } as never,
			text: 'ok'
		})
	);
	expect(result.text).toBe('ok');
	expect(calls).toMatchObject([
		{ role: 'review', modelId: 'claude-sonnet-5', usage: { inputTokens: 10 } }
	]);
});

test('reports a failure with the provider status, then rethrows', async () => {
	const failures: ModelFailure[] = [];
	const call = callModel('verify', model, { onModelError: (f) => void failures.push(f) }, () =>
		Promise.reject(rateLimited())
	);
	expect(call).rejects.toBeInstanceOf(RetryError);
	await call.catch(() => {});
	expect(failures).toMatchObject([
		{ role: 'verify', provider: 'anthropic', message: 'Rate limit exceeded', status: 429 }
	]);
});

test('a cancelled call is not a failure', async () => {
	const controller = new AbortController();
	controller.abort();
	const failures: ModelFailure[] = [];
	const call = callModel(
		'chat',
		model,
		{ signal: controller.signal, onModelError: (f) => void failures.push(f) },
		() => Promise.reject(new Error('aborted'))
	);
	await call.catch(() => {});
	expect(failures).toEqual([]);
});
