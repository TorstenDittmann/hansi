import { redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { legacyAppDestination } from '$lib/org-path';
import { getAuth } from '$lib/server/auth';
import { organizationsFor } from '$lib/server/organization';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/ink/')) return proxyPostHog(event);

	event.locals.user = null;
	event.locals.session = null;

	// /api handles its own auth (better-auth routes, signed webhooks).
	if (event.url.pathname.startsWith('/api/')) return resolve(event);

	const auth = await getAuth();
	const result = await auth.api.getSession({ headers: event.request.headers });
	if (result) {
		event.locals.user = result.user;
		event.locals.session = result.session;
	}

	if (event.url.pathname.startsWith('/app') && !event.locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(event.url.pathname)}`);
	}

	// `/app` and the old unscoped pages land on the same page under the active organization.
	if (event.locals.user && legacyAppDestination(event.url.pathname, '', '_')) {
		const { active } = await organizationsFor(event.locals, event.request.headers);
		const destination = legacyAppDestination(event.url.pathname, event.url.search, active.slug);
		if (destination) redirect(303, destination);
	}

	return resolve(event);
};

function proxyPostHog(event: RequestEvent) {
	const pathname = event.url.pathname.slice('/ink'.length);
	const url = new URL(event.url);
	url.protocol = 'https:';
	url.hostname = /^\/(static|array)\//.test(pathname)
		? 'eu-assets.i.posthog.com'
		: 'eu.i.posthog.com';
	url.port = '';
	url.pathname = pathname;

	const headers = new Headers(event.request.headers);
	headers.set('host', url.hostname);
	headers.delete('cookie');
	headers.delete('authorization');
	headers.set('accept-encoding', '');
	headers.set(
		'x-forwarded-for',
		event.request.headers.get('x-forwarded-for') || event.getClientAddress()
	);

	return fetch(url, {
		method: event.request.method,
		headers,
		body: event.request.body,
		duplex: 'half'
	} as RequestInit);
}
