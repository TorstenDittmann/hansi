import { redirect } from '@sveltejs/kit';
import { organizationHome } from '$lib/org-path';
import { getGitHubCredentials } from '$lib/server/context';
import { organizationsFor } from '$lib/server/organization';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request, url }) => {
	if (!(await getGitHubCredentials())) redirect(303, '/setup');
	const redirectTo = url.searchParams.get('redirectTo');
	// Only allow same-site relative paths as the post-login destination.
	const destination =
		redirectTo?.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : null;
	if (locals.user) {
		const home =
			destination ??
			organizationHome((await organizationsFor(locals, request.headers)).active.slug);
		redirect(303, home);
	}
	// better-auth redirects OAuth failures (e.g. a rejected sign-up) back here with ?error=.
	const error = url.searchParams.get('error');
	// Come back here after GitHub sign-in so the new session can be sent to its organization.
	return { destination: destination ?? '/login', error: error ? error.replaceAll('_', ' ') : null };
};
