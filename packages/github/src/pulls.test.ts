import { expect, test } from 'bun:test';
import type { Octokit } from './app';
import { resolveReviewThreads } from './pulls';

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
