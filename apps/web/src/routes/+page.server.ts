import { redirect } from '@sveltejs/kit';
import { getGitHubCredentials } from '$lib/server/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const configured = !!(await getGitHubCredentials());
	if (configured && locals.user) redirect(303, '/app');
	return { configured };
};
