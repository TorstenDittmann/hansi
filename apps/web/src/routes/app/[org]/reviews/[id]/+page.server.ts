import { error, fail, redirect } from '@sveltejs/kit';
import { getContext } from '$lib/server/context';
import { getReview } from '$lib/server/data';
import { retryFailedReview } from '$lib/server/jobs';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { organization } = await parent();
	const review = await getReview(organization.id, params.id);
	if (!review) error(404, 'Review not found');
	return { review };
};

export const actions: Actions = {
	retry: async ({ locals, params, request }) => {
		const organization = await requireOrganization(locals, request.headers, params.org);
		const { db, queue } = await getContext();
		const result = await retryFailedReview(db, queue, organization.id, params.id);
		if (!result.ok && result.reason === 'not-found') error(404, 'Review not found');
		if (!result.ok) return fail(400, { error: 'Only a failed review can be retried' });
		redirect(303, `/app/${params.org}/reviews/${result.reviewId}`);
	}
};
