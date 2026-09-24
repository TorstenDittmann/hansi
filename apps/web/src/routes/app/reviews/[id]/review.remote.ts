import { error } from '@sveltejs/kit';
import { getRequestEvent, query } from '$app/server';
import { streamReview } from '$lib/live';
import { getReview } from '$lib/server/data';
import { requireOrganization } from '$lib/server/organization';
import { z } from 'zod';

/** Streams the review while it is queued or running, then closes on a terminal status. */
export const watchReview = query.live(z.string().min(1), async function* (reviewId: string) {
	const event = getRequestEvent();
	const organization = await requireOrganization(event.locals, event.request.headers);
	let yielded = false;
	for await (const review of streamReview(() => getReview(organization.id, reviewId), {
		signal: event.request.signal
	})) {
		yielded = true;
		yield review;
	}
	if (!yielded && !event.request.signal.aborted) error(404, 'Review not found');
});
