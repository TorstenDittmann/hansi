import { redirect } from '@sveltejs/kit';
import { getGitHubCredentials } from '$lib/server/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!(await getGitHubCredentials())) redirect(303, '/setup');
	const redirectTo = url.searchParams.get('redirectTo');
	// Only allow same-site relative paths as the post-login destination.
	const destination =
		redirectTo?.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : '/app';
	if (locals.user) redirect(303, destination);
	// better-auth redirects OAuth failures (e.g. a rejected sign-up) back here with ?error=.
	const error = url.searchParams.get('error');
	return { destination, error: error ? error.replaceAll('_', ' ') : null };
};
