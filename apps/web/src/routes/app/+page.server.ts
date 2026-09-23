import { getCostSummary, listReviews } from '$lib/server/data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organization } = await parent();
	const [costs, reviews] = await Promise.all([
		getCostSummary(organization.id),
		listReviews(organization.id, 10)
	]);
	return { costs, reviews };
};
