import { RequestError } from 'octokit';
import type { Octokit } from './app';

export interface RepoRef {
	owner: string;
	repo: string;
}

export function parseFullName(fullName: string): RepoRef {
	const [owner, repo] = fullName.split('/');
	if (!owner || !repo) throw new Error(`Invalid repository name: ${fullName}`);
	return { owner, repo };
}

export async function getPullRequest(octokit: Octokit, ref: RepoRef, pullNumber: number) {
	const { data } = await octokit.rest.pulls.get({ ...ref, pull_number: pullNumber });
	return {
		number: data.number,
		title: data.title,
		body: data.body ?? '',
		author: data.user?.login ?? 'unknown',
		authorAssociation: data.author_association,
		draft: data.draft ?? false,
		state: data.state,
		baseRef: data.base.ref,
		baseSha: data.base.sha,
		headSha: data.head.sha,
		cloneUrl: data.base.repo.clone_url
	};
}

export type PullRequest = Awaited<ReturnType<typeof getPullRequest>>;

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * Whether the PR author can write to the repository. The author association is checked first;
 * members with private org membership can show up as CONTRIBUTOR there, so anyone else is
 * checked against their actual repository permission. Errors count as untrusted.
 */
export async function isTrustedAuthor(
	octokit: Octokit,
	ref: RepoRef,
	pr: { author: string; authorAssociation: string }
): Promise<boolean> {
	if (TRUSTED_ASSOCIATIONS.has(pr.authorAssociation)) return true;
	try {
		const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
			...ref,
			username: pr.author
		});
		return data.permission === 'admin' || data.permission === 'write';
	} catch {
		return false;
	}
}

/** Reads a file at a ref, or `null` when it does not exist. */
export async function getFileContent(
	octokit: Octokit,
	ref: RepoRef,
	path: string,
	gitRef: string
): Promise<string | null> {
	try {
		const { data } = await octokit.rest.repos.getContent({ ...ref, path, ref: gitRef });
		if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null;
		return Buffer.from(data.content, 'base64').toString('utf8');
	} catch (error) {
		if (error instanceof RequestError && error.status === 404) return null;
		throw error;
	}
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface ReviewComment {
	path: string;
	/** Right-side line in the new file; must be part of the diff. */
	line: number;
	startLine?: number;
	body: string;
}

/**
 * Posts all comments as a single review. One request instead of one per comment keeps us clear
 * of GitHub's secondary rate limits and notifies the author once.
 */
export async function createReview(
	octokit: Octokit,
	ref: RepoRef,
	input: {
		pullNumber: number;
		commitId: string;
		body: string;
		comments: ReviewComment[];
		/** Approve, request changes, or only comment. */
		event: ReviewEvent;
	}
) {
	const { data } = await octokit.rest.pulls.createReview({
		...ref,
		pull_number: input.pullNumber,
		commit_id: input.commitId,
		event: input.event,
		body: input.body,
		comments: input.comments.map((comment) => ({
			path: comment.path,
			line: comment.line,
			side: 'RIGHT' as const,
			...(comment.startLine && comment.startLine < comment.line
				? { start_line: comment.startLine, start_side: 'RIGHT' as const }
				: {}),
			body: comment.body
		}))
	});
	return data;
}

export async function createIssueComment(
	octokit: Octokit,
	ref: RepoRef,
	issueNumber: number,
	body: string
) {
	await octokit.rest.issues.createComment({ ...ref, issue_number: issueNumber, body });
}

export async function startCheckRun(
	octokit: Octokit,
	ref: RepoRef,
	input: { headSha: string; name: string; detailsUrl?: string }
) {
	const { data } = await octokit.rest.checks.create({
		...ref,
		name: input.name,
		head_sha: input.headSha,
		status: 'in_progress',
		details_url: input.detailsUrl,
		started_at: new Date().toISOString()
	});
	return data.id;
}

export async function completeCheckRun(
	octokit: Octokit,
	ref: RepoRef,
	checkRunId: number,
	input: {
		conclusion: 'success' | 'neutral' | 'failure' | 'skipped' | 'cancelled';
		title: string;
		summary: string;
	}
) {
	await octokit.rest.checks.update({
		...ref,
		check_run_id: checkRunId,
		status: 'completed',
		conclusion: input.conclusion,
		completed_at: new Date().toISOString(),
		output: { title: input.title, summary: input.summary }
	});
}

/** Review comments GitHub created for a review, to link findings to their comment ids. */
export async function listReviewComments(
	octokit: Octokit,
	ref: RepoRef,
	pullNumber: number,
	reviewId: number
) {
	return octokit.paginate(octokit.rest.pulls.listCommentsForReview, {
		...ref,
		pull_number: pullNumber,
		review_id: reviewId,
		per_page: 100
	});
}

export interface ThreadComment {
	id: number;
	author: string;
	body: string;
	isBot: boolean;
	path?: string;
	line?: number | null;
	diffHunk?: string;
}

/** A review comment thread: the root comment and its replies, oldest first. */
export async function getReviewThread(
	octokit: Octokit,
	ref: RepoRef,
	pullNumber: number,
	rootCommentId: number
): Promise<ThreadComment[]> {
	const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
		...ref,
		pull_number: pullNumber,
		per_page: 100
	});
	return comments
		.filter((c) => c.id === rootCommentId || c.in_reply_to_id === rootCommentId)
		.sort((a, b) => a.created_at.localeCompare(b.created_at))
		.map((c) => ({
			id: c.id,
			author: c.user?.login ?? 'unknown',
			body: c.body,
			isBot: c.user?.type === 'Bot',
			path: c.path,
			line: c.line ?? c.original_line ?? null,
			diffHunk: c.diff_hunk
		}));
}

/** The most recent conversation comments on a pull request, oldest first. */
export async function getRecentIssueComments(
	octokit: Octokit,
	ref: RepoRef,
	issueNumber: number,
	limit = 20
): Promise<ThreadComment[]> {
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {
		...ref,
		issue_number: issueNumber,
		per_page: 100
	});
	return comments.slice(-limit).map((c) => ({
		id: c.id,
		author: c.user?.login ?? 'unknown',
		body: c.body ?? '',
		isBot: c.user?.type === 'Bot'
	}));
}

export async function replyToReviewComment(
	octokit: Octokit,
	ref: RepoRef,
	pullNumber: number,
	commentId: number,
	body: string
) {
	await octokit.rest.pulls.createReplyForReviewComment({
		...ref,
		pull_number: pullNumber,
		comment_id: commentId,
		body
	});
}

/** Acknowledges a comment with 👀 so people know Hansi is working on it. */
export async function acknowledgeComment(
	octokit: Octokit,
	ref: RepoRef,
	comment: { id: number; kind: 'issue' | 'review' }
) {
	if (comment.kind === 'issue') {
		await octokit.rest.reactions.createForIssueComment({
			...ref,
			comment_id: comment.id,
			content: 'eyes'
		});
	} else {
		await octokit.rest.reactions.createForPullRequestReviewComment({
			...ref,
			comment_id: comment.id,
			content: 'eyes'
		});
	}
}

/**
 * Creates the comment on first use and edits it afterwards, found by a hidden marker in its body,
 * so a pull request always has exactly one summary from the bot.
 */
export async function upsertMarkedComment(
	octokit: Octokit,
	ref: RepoRef,
	issueNumber: number,
	marker: string,
	body: string
): Promise<{ id: number; url: string }> {
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {
		...ref,
		issue_number: issueNumber,
		per_page: 100
	});
	const existing = comments.find((c) => c.user?.type === 'Bot' && c.body?.includes(marker));
	if (existing) {
		const { data } = await octokit.rest.issues.updateComment({
			...ref,
			comment_id: existing.id,
			body
		});
		return { id: data.id, url: data.html_url };
	}
	const { data } = await octokit.rest.issues.createComment({
		...ref,
		issue_number: issueNumber,
		body
	});
	return { id: data.id, url: data.html_url };
}
