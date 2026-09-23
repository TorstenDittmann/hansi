import { parseRepoConfig } from '@hans/config';
import { checkoutPullRequest, runChat, type ThreadMessage } from '@hans/core';
import { schema } from '@hans/db';
import {
	acknowledgeComment,
	createIssueComment,
	getFileContent,
	getInstallationToken,
	getPullRequest,
	getRecentIssueComments,
	getReviewThread,
	replyToReviewComment,
	resolveReviewThreads
} from '@hans/github';
import type { ChatJobPayload, Job } from '@hans/queue';
import { and, eq } from 'drizzle-orm';
import {
	connectRepository,
	createUsageRecorder,
	loadLearnings,
	loadModels,
	withWorkdir,
	type WorkerContext
} from './shared';

export async function handleChatJob(ctx: WorkerContext, job: Job<ChatJobPayload>) {
	const { db, env, logger } = ctx;
	const payload = job.payload;
	const log = logger.child({ jobId: job.id, commentId: payload.commentId });

	const connection = await connectRepository(ctx, payload.repositoryId);
	if (!connection) return;
	const { octokit, ref } = connection;

	if (job.attempts === 1) {
		await acknowledgeComment(octokit, ref, { id: payload.commentId, kind: payload.kind }).catch(
			(error) => log.warn({ err: error }, 'could not react to comment')
		);
	}

	const reply = async (body: string) => {
		if (payload.kind === 'review') {
			await replyToReviewComment(
				octokit,
				ref,
				payload.pullNumber,
				payload.rootCommentId ?? payload.commentId,
				body
			);
		} else {
			await createIssueComment(octokit, ref, payload.pullNumber, body);
		}
	};

	try {
		const pr = await getPullRequest(octokit, ref, payload.pullNumber);
		// Settings and guidelines come from the base branch, which the PR author cannot change.
		const { config } = parseRepoConfig(
			await getFileContent(octokit, ref, '.hansi.yml', pr.baseSha)
		);

		const comments =
			payload.kind === 'review'
				? await getReviewThread(
						octokit,
						ref,
						payload.pullNumber,
						payload.rootCommentId ?? payload.commentId
					)
				: await getRecentIssueComments(octokit, ref, payload.pullNumber);
		const thread: ThreadMessage[] = comments.map((c) => ({
			author: c.author,
			body: c.body,
			fromBot: c.isBot
		}));
		const root = comments[0];
		const focus =
			payload.kind === 'review' && root?.path
				? { path: root.path, line: root.line ?? undefined, diffHunk: root.diffHunk }
				: undefined;

		// Replies on a finding Hansi posted can resolve or dismiss that finding.
		const [finding] = payload.rootCommentId
			? await db
					.select({ id: schema.reviewFindings.id })
					.from(schema.reviewFindings)
					.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
					.where(
						and(
							eq(schema.reviewFindings.githubCommentId, payload.rootCommentId),
							eq(schema.reviews.organizationId, payload.organizationId)
						)
					)
			: [];

		let settled = false;
		const { review: model } = await loadModels(ctx, payload.organizationId);
		const usage = await createUsageRecorder(db, { organizationId: payload.organizationId });
		const learnings = await loadLearnings(db, payload.organizationId, payload.repositoryId);

		const token = await getInstallationToken(octokit);
		const answer = await withWorkdir(env, async (repoDir) => {
			const diff = await checkoutPullRequest({
				dir: repoDir,
				cloneUrl: pr.cloneUrl,
				token,
				pullNumber: pr.number,
				baseSha: pr.baseSha,
				headSha: pr.headSha
			});
			return runChat({
				repoDir,
				pullRequest: pr,
				diff,
				thread,
				focus,
				learnings,
				trustedSource: { ref: pr.baseSha, token },
				language: config.language,
				model,
				onModelCall: usage.record,
				onRemember: async (rule) => {
					await db.insert(schema.learnings).values({
						organizationId: payload.organizationId,
						repositoryId: payload.repositoryId,
						body: rule,
						author: payload.author,
						sourceUrl: payload.commentUrl
					});
				},
				onMarkFinding: finding
					? async (status, reason) => {
							await db
								.update(schema.reviewFindings)
								.set({ status, dropReason: reason })
								.where(eq(schema.reviewFindings.id, finding.id));
							settled = true;
						}
					: undefined
			});
		});

		await reply(answer);
		// A finding settled in the conversation (fixed, or intended) closes its thread after the answer.
		if (settled && payload.rootCommentId) {
			await resolveReviewThreads(octokit, ref, payload.pullNumber, [payload.rootCommentId]).catch(
				(error) => log.warn({ err: error }, 'could not resolve thread')
			);
		}
		log.info('chat reply posted');
	} catch (error) {
		// Tell the person instead of leaving them waiting, but only once retries are exhausted.
		if (job.attempts >= job.maxAttempts) {
			const message = error instanceof Error ? error.message : String(error);
			await reply(`Sorry, I couldn't answer that: ${message.slice(0, 300)}`).catch(() => {});
		}
		throw error;
	}
}
