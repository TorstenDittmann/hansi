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
	/**
	 * GitHub `author_association` of the commenter (OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR,
	 * NONE, …). Missing on a job queued before this field existed; treat that as untrusted.
	 */
	authorAssociation: string;
	commentUrl: string;
}

/** The chat job for one webhook comment. Association comes from GitHub, not the comment body. */
export function chatJobFromComment(input: {
	organizationId: string;
	repositoryId: number;
	pullNumber: number;
	kind: 'issue' | 'review';
	rootCommentId?: number;
	comment: {
		id: number;
		html_url: string;
		author_association: string;
		user: { login: string };
	};
}): ChatJobPayload {
	return {
		organizationId: input.organizationId,
		repositoryId: input.repositoryId,
		pullNumber: input.pullNumber,
		commentId: input.comment.id,
		kind: input.kind,
		rootCommentId: input.rootCommentId,
		author: input.comment.user.login,
		authorAssociation: input.comment.author_association,
		commentUrl: input.comment.html_url
	};
}

export const queues = { review: 'review', chat: 'chat' } as const;
