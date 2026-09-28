import type { ChatJobPayload, Queue } from '@hans/queue';
import { queues } from '@hans/queue';

export { enqueueReview, type EnqueueReviewInput } from '@hans/queue';

/** Queues an answer to a comment. Chat jobs are never deduplicated: every question gets a reply. */
export async function enqueueChat(queue: Queue, payload: ChatJobPayload) {
	await queue.send<ChatJobPayload>(queues.chat, payload, { maxAttempts: 2 });
}
