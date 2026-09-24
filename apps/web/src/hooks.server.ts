import { redirect, type Handle } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
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

	return resolve(event);
};
