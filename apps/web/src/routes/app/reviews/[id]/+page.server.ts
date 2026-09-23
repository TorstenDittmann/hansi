import { error } from '@sveltejs/kit';
import { getReview } from '$lib/server/data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { organization } = await parent();
	const review = await getReview(organization.id, params.id);
	if (!review) error(404, 'Review not found');
	return { review };
};
