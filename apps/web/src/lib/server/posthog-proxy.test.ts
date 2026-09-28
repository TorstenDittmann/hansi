import { expect, test } from 'bun:test';
import type { Handle } from '@sveltejs/kit';
import { posthogProxy, posthogUpstream } from './posthog-proxy';

test('events go to the EU ingestion host and keep the query string', () => {
	const url = posthogUpstream(new URL('https://hansi.codes/ink/e/?ver=1.2'));
	expect(url?.href).toBe('https://eu.i.posthog.com/e/?ver=1.2');
});

test('sdk assets go to the EU asset host', () => {
	expect(posthogUpstream(new URL('https://hansi.codes/ink/static/array.js'))?.href).toBe(
		'https://eu-assets.i.posthog.com/static/array.js'
	);
	expect(posthogUpstream(new URL('https://hansi.codes/ink/array/phc_test'))?.href).toBe(
		'https://eu-assets.i.posthog.com/array/phc_test'
	);
});

test('the bare proxy path and lookalike routes are not ingestion paths', () => {
	expect(posthogUpstream(new URL('https://hansi.codes/ink'))?.pathname).toBe('/');
	expect(posthogUpstream(new URL('https://hansi.codes/inkling'))).toBeNull();
	expect(posthogUpstream(new URL('https://hansi.codes/app'))).toBeNull();
});

test('the hook forwards the body and drops cookies and authorization', async () => {
	const calls: { url: string; headers: Headers; body: BodyInit | null | undefined }[] = [];
	const original = globalThis.fetch;
	globalThis.fetch = (async (input, init) => {
		calls.push({
			url: String(input),
			headers: new Headers(init?.headers),
			body: init?.body
		});
		return new Response('ok', { status: 200 });
	}) as typeof fetch;

	try {
		const request = new Request('https://hansi.codes/ink/e/', {
			method: 'POST',
			headers: {
				cookie: 'session=secret',
				authorization: 'Bearer secret',
				'content-type': 'application/json',
				'x-forwarded-for': '198.51.100.8, 10.0.0.1'
			},
			body: '{"event":"signed in"}'
		});
		const response = await posthogProxy({
			event: {
				url: new URL(request.url),
				request,
				getClientAddress: () => '203.0.113.5'
			} as Parameters<Handle>[0]['event'],
			resolve: async () => new Response('not proxied', { status: 500 })
		});

		expect(response.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe('https://eu.i.posthog.com/e/');
		expect(calls[0]?.headers.get('cookie')).toBeNull();
		expect(calls[0]?.headers.get('authorization')).toBeNull();
		expect(calls[0]?.headers.get('host')).toBe('eu.i.posthog.com');
		expect(calls[0]?.headers.get('x-forwarded-for')).toBe('198.51.100.8, 10.0.0.1');
		expect(calls[0]?.headers.get('accept-encoding')).toBe('');
		expect(await new Response(calls[0]?.body).text()).toBe('{"event":"signed in"}');
	} finally {
		globalThis.fetch = original;
	}
});

test('other requests continue to the app', async () => {
	let fetched = false;
	const original = globalThis.fetch;
	globalThis.fetch = (async () => {
		fetched = true;
		return new Response('nope');
	}) as unknown as typeof fetch;

	try {
		const request = new Request('https://hansi.codes/app');
		const response = await posthogProxy({
			event: {
				url: new URL(request.url),
				request,
				getClientAddress: () => '203.0.113.5'
			} as Parameters<Handle>[0]['event'],
			resolve: async () => new Response('app', { status: 200 })
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('app');
		expect(fetched).toBe(false);
	} finally {
		globalThis.fetch = original;
	}
});
