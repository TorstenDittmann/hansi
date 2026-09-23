// Job payloads shared by producers (web) and consumers (worker).

export interface ReviewJobPayload {
	reviewId: string;
}

export interface ChatJobPayload {
	organizationId: string;
	repositoryId: number;
	pullNumber: number;
	/** The comment to answer. */
	commentId: number;
	/** `review`: a thread on a line of code; `issue`: the PR conversation. */
	kind: 'issue' | 'review';
	/** For review threads: the first comment of the thread (replies attach to it). */
	rootCommentId?: number;
	author: string;
	commentUrl: string;
}

export const queues = { review: 'review', chat: 'chat' } as const;
