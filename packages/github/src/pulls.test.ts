import { expect, test } from 'bun:test';
import type { Octokit } from './app';
import { getFailedChecks, getLinkedIssues, resolveReviewThreads } from './pulls';

const thread = (id: string, root: number, isResolved = false) => ({
	id,
	isResolved,
	comments: { nodes: [{ databaseId: root }] }
});

test('resolves only open threads that start with the given comments, across pages', async () => {
	const pages = [
		{ nodes: [thread('T1', 11), thread('T2', 22)], next: 'c1' },
		{ nodes: [thread('T3', 33, true), thread('T4', 44)], next: null }
	];
	const resolved: string[] = [];
	const octokit = {
		graphql: async (query: string, variables: { cursor?: string | null; threadId?: string }) => {
			if (query.includes('resolveReviewThread')) {
				resolved.push(variables.threadId!);
				return {};
			}
			const page = pages[variables.cursor ? 1 : 0]!;
			return {
				repository: {
					pullRequest: {
						reviewThreads: {
							pageInfo: { hasNextPage: !!page.next, endCursor: page.next },
							nodes: page.nodes
						}
					}
				}
			};
		}
	} as unknown as Octokit;

	const count = await resolveReviewThreads(octokit, { owner: 'o', repo: 'r' }, 1, [11, 33, 44, 99]);
	expect(resolved).toEqual(['T1', 'T4']); // T3 is already resolved, 99 has no thread
	expect(count).toBe(2);
});

test('does nothing without comments to resolve', async () => {
	const octokit = { graphql: () => Promise.reject(new Error('should not be called')) };
	expect(
		await resolveReviewThreads(octokit as unknown as Octokit, { owner: 'o', repo: 'r' }, 1, [])
	).toBe(0);
});

test('getLinkedIssues keeps only issues from the same repository', async () => {
	const issue = (number: number, repo: string) => ({
		number,
		title: `Issue ${number}`,
		body: 'x'.repeat(5_000),
		repository: { nameWithOwner: repo }
	});
	const octokit = {
		graphql: async () => ({
			repository: {
				pullRequest: {
					closingIssuesReferences: { nodes: [issue(1, 'O/R'), issue(2, 'o/private')] }
				}
			}
		})
	} as unknown as Octokit;

	const issues = await getLinkedIssues(octokit, { owner: 'o', repo: 'r' }, 7);
	expect(issues.map((i) => i.number)).toEqual([1]);
	expect(issues[0]!.body).toEndWith('… truncated');
});

test('getFailedChecks returns failed runs of other apps with their annotations', async () => {
	const run = (id: number, name: string, conclusion: string | null, appId = 1) => ({
		id,
		name,
		status: conclusion ? 'completed' : 'in_progress',
		conclusion,
		app: { id: appId },
		output: {
			title: `${name} title`,
			summary: null,
			text: null,
			annotations_count: id === 1 ? 2 : 0
		}
	});
	const octokit = {
		paginate: async () => [
			run(1, 'test', 'failure'),
			run(2, 'lint', 'success'),
			run(3, 'build', null),
			run(4, 'Hansi', 'failure', 99)
		],
		rest: {
			checks: {
				listForRef: {},
				listAnnotations: async () => ({
					data: [
						{ path: 'a.ts', start_line: 3, annotation_level: 'failure', message: 'boom' },
						{ path: 'b.ts', start_line: 1, annotation_level: 'notice', message: 'fyi' }
					]
				})
			}
		}
	} as unknown as Octokit;

	expect(await getFailedChecks(octokit, { owner: 'o', repo: 'r' }, 'sha', '99')).toEqual([
		{
			name: 'test',
			conclusion: 'failure',
			output: 'test title',
			annotations: [{ path: 'a.ts', line: 3, message: 'boom' }]
		}
	]);
});
