import { redirect } from '@sveltejs/kit';
import { organizationHome } from '$lib/org-path';
import { getContext, getGitHubCredentials } from '$lib/server/context';
import { organizationsFor } from '$lib/server/organization';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from '$lib/seo';
import { SUNSET_TITLE, sunsetDescription } from '$lib/sunset';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request }) => {
	const { env } = await getContext();
	const configured = !!(await getGitHubCredentials());

	// The hosted service is shutting down: everyone gets the sunset page, and people who are
	// signed in get a link back to their dashboard instead of a redirect.
	if (env.SUNSET_DATE) {
		const organization =
			configured && locals.user
				? (await organizationsFor(locals, request.headers)).active.slug
				: null;
		return {
			configured,
			sunset: { date: env.SUNSET_DATE, organization },
			title: SUNSET_TITLE,
			description: sunsetDescription(env.SUNSET_DATE)
		};
	}

	if (configured && locals.user) {
		const { active } = await organizationsFor(locals, request.headers);
		redirect(303, organizationHome(active.slug));
	}
	return { configured, sunset: null, title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
};
