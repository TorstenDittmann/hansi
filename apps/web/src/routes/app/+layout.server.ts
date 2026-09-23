import { getGitHubCredentials } from '$lib/server/context';
import { requireOrganization } from '$lib/server/organization';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, request }) => {
	const organization = await requireOrganization(locals, request.headers);
	const credentials = await getGitHubCredentials();
	return {
		organization: { id: organization.id, name: organization.name },
		appSlug: credentials?.slug ?? null
	};
};
