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
		draft: data.draft ?? false,
		state: data.state,
		baseRef: data.base.ref,
		baseSha: data.base.sha,
		headSha: data.head.sha,
		cloneUrl: data.base.repo.clone_url
	};
}

export type PullRequest = Awaited<ReturnType<typeof getPullRequest>>;

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
	input: { pullNumber: number; commitId: string; body: string; comments: ReviewComment[] }
) {
	const { data } = await octokit.rest.pulls.createReview({
		...ref,
		pull_number: input.pullNumber,
		commit_id: input.commitId,
		event: 'COMMENT',
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
