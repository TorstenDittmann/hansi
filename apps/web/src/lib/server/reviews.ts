import { schema, type Database, type ReviewTrigger } from '@hans/db';
import type { Queue } from '@hans/queue';
import { and, eq } from 'drizzle-orm';

export interface EnqueueReviewInput {
	organizationId: string;
	repositoryId: number;
	pullNumber: number;
	/** Known for pull_request events; the worker resolves it for mentions. */
	headSha: string;
	trigger: ReviewTrigger;
}

/**
 * Creates a review and queues it. Older queued reviews for the same PR are superseded: the
 * singleton key makes the queue hold one pending job per PR, pointing at the newest review.
 */
export async function enqueueReview(db: Database, queue: Queue, input: EnqueueReviewInput) {
	await db
		.update(schema.reviews)
		.set({ status: 'superseded' })
		.where(
			and(
				eq(schema.reviews.repositoryId, input.repositoryId),
				eq(schema.reviews.pullNumber, input.pullNumber),
				eq(schema.reviews.status, 'queued')
			)
		);

	const [review] = await db.insert(schema.reviews).values(input).returning();
	await queue.send(
		'review',
		{ reviewId: review!.id },
		{ singletonKey: `${input.repositoryId}:${input.pullNumber}` }
	);
	return review!;
}
