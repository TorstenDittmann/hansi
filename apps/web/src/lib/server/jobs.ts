import { schema, type Database, type ReviewTrigger } from '@hans/db';
import { queues, type ChatJobPayload, type Queue, type ReviewJobPayload } from '@hans/queue';
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
	await queue.send<ReviewJobPayload>(
		queues.review,
		{ reviewId: review!.id },
		{ singletonKey: `${input.repositoryId}:${input.pullNumber}` }
	);
	return review!;
}

/** Queues an answer to a comment. Chat jobs are never deduplicated: every question gets a reply. */
export async function enqueueChat(queue: Queue, payload: ChatJobPayload) {
	await queue.send<ChatJobPayload>(queues.chat, payload, { maxAttempts: 2 });
}

export type RetryReviewResult =
	{ ok: true; reviewId: string } | { ok: false; reason: 'not-found' | 'not-failed' };

/**
 * Queues another review of the same pull request. The failed row stays as the record of that
 * attempt; a worker picks up the new one with a fresh set of attempts.
 */
export async function retryFailedReview(
	db: Database,
	queue: Queue,
	organizationId: string,
	reviewId: string
): Promise<RetryReviewResult> {
	const [existing] = await db
		.select({
			repositoryId: schema.reviews.repositoryId,
			pullNumber: schema.reviews.pullNumber,
			headSha: schema.reviews.headSha,
			status: schema.reviews.status
		})
		.from(schema.reviews)
		.where(and(eq(schema.reviews.id, reviewId), eq(schema.reviews.organizationId, organizationId)));
	if (!existing) return { ok: false, reason: 'not-found' };
	if (existing.status !== 'failed') return { ok: false, reason: 'not-failed' };

	const review = await enqueueReview(db, queue, {
		organizationId,
		repositoryId: existing.repositoryId,
		pullNumber: existing.pullNumber,
		headSha: existing.headSha,
		trigger: 'manual'
	});
	return { ok: true, reviewId: review.id };
}
