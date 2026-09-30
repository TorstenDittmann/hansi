import { organizationSlugFromPath } from '$lib/org-path';
import { getGitHubCredentials } from '$lib/server/context';
import { organizationsFor } from '$lib/server/organization';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, request, url }) => {
	const slug = organizationSlugFromPath(url.pathname);
	const { active, organizations } = await organizationsFor(locals, request.headers, slug);
	const credentials = await getGitHubCredentials();
	return {
		organization: { id: active.id, name: active.name, slug: active.slug },
		organizations: organizations.map((org) => ({ id: org.id, name: org.name, slug: org.slug })),
		appSlug: credentials?.slug ?? null
	};
};
