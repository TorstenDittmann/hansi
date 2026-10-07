// Job payloads shared by producers (web) and consumers (worker).

export interface ReviewJobPayload {
	reviewId: string;
	/**
	 * The comment that asked for this review. Set for `@slug review` mentions, absent for
	 * pushes and manual retries. The worker reacts on it and replies there when it skips.
	 */
	commentId?: number;
	/** Whether that comment is on the pull request conversation or a review thread. */
	commentKind?: 'issue' | 'review';
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
