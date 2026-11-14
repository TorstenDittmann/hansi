import { redirect } from '@sveltejs/kit';
import { organizationHome } from '$lib/org-path';
import { getGitHubCredentials } from '$lib/server/context';
import { organizationsFor } from '$lib/server/organization';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from '$lib/seo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request }) => {
	const configured = !!(await getGitHubCredentials());
	if (configured && locals.user) {
		const { active } = await organizationsFor(locals, request.headers);
		redirect(303, organizationHome(active.slug));
	}
	return { configured, title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
};
