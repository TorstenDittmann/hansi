import { POSTHOG_ASSETS_HOST, POSTHOG_HOST, POSTHOG_PROXY_PATH } from '@hans/analytics/constants';
import type { Handle } from '@sveltejs/kit';

const API_HOST = new URL(POSTHOG_HOST).hostname;
const ASSETS_HOST = new URL(POSTHOG_ASSETS_HOST).hostname;

/**
 * Rewrites a first-party analytics request onto PostHog's EU hosts.
 * `/static/` and `/array/` are SDK assets; everything else is the ingestion API.
 * Returns null when the path is not the proxy, including lookalikes such as `/inkling`.
 */
export function posthogUpstream(requestUrl: URL): URL | null {
	const { pathname } = requestUrl;
	const path = POSTHOG_PROXY_PATH;
	if (pathname !== path && !pathname.startsWith(`${path}/`)) return null;

	const useAssetHost =
		pathname.startsWith(`${path}/static/`) || pathname.startsWith(`${path}/array/`);
	const url = new URL(requestUrl);
	url.protocol = 'https:';
	url.hostname = useAssetHost ? ASSETS_HOST : API_HOST;
	url.port = '443';
	url.pathname = pathname.slice(path.length) || '/';
	return url;
}

/** Forwards `/ink` to PostHog before auth, so session cookies never leave this app. */
export const posthogProxy: Handle = async ({ event, resolve }) => {
	const url = posthogUpstream(event.url);
	if (!url) return resolve(event);

	const headers = new Headers(event.request.headers);
	headers.set('host', url.hostname);
	// Remove cookies and auth headers before forwarding to PostHog.
	headers.delete('cookie');
	headers.delete('authorization');
	headers.set('accept-encoding', '');

	const clientIp = event.request.headers.get('x-forwarded-for') || event.getClientAddress();
	if (clientIp) headers.set('x-forwarded-for', clientIp);

	// `duplex` is required when forwarding a streaming request body. It is not on the
	// DOM `RequestInit` type, so the init object is checked against the intersection.
	const init = {
		method: event.request.method,
		headers,
		body: event.request.body,
		duplex: 'half' as const
	} satisfies RequestInit & { duplex: 'half' };
	return fetch(url, init);
};
