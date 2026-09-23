import { getGitHubCredentials } from '$lib/server/context';
import { organizationsFor } from '$lib/server/organization';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, request }) => {
	const { active, organizations } = await organizationsFor(locals, request.headers);
	const credentials = await getGitHubCredentials();
	return {
		organization: { id: active.id, name: active.name },
		organizations: organizations.map((org) => ({ id: org.id, name: org.name })),
		appSlug: credentials?.slug ?? null
	};
};
