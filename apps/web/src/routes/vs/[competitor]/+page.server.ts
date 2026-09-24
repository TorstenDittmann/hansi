import { error } from '@sveltejs/kit';
import { findComparison } from '$lib/comparisons';
import { getGitHubCredentials } from '$lib/server/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const comparison = findComparison(params.competitor);
	if (!comparison) error(404, 'Not found');
	return { comparison, configured: !!(await getGitHubCredentials()) };
};
