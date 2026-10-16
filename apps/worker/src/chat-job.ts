import { blockingSeverity, parseRepoConfig, REPO_CONFIG_FILE } from '@hans/config';
import { absolutizeLinks, checkoutPullRequest, runChat, type ThreadMessage } from '@hans/core';
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
import { inArray } from 'drizzle-orm';
import {
	chatReplyFields,
	findingsNamedIn,
	loadChatFinding,
	loadOpenBodyFindings,
	type ChatFindingRow
} from './chat-finding';
import { repliesToBot } from './chat-reply';
import { chatFailureReply } from './public-failure';
import { lazySandbox, openSandbox, sandboxEnabled } from './sandbox';
import {
	connectRepository,
	createUsageRecorder,
	loadLearnings,
	loadModels,
	withWorkdir,
	type WorkerContext
} from './shared';
import { refreshSummaryAfterSettlement } from './summary';

export async function handleChatJob(ctx: WorkerContext, job: Job<ChatJobPayload>) {
	const { db, env, logger } = ctx;
	const payload = job.payload;
	const log = logger.child({ jobId: job.id, commentId: payload.commentId });

	// Findings GitHub would not take inline have no thread; a conversation comment answers them.
	const bodyFindings =
		payload.kind === 'issue'
			? await loadOpenBodyFindings(db, {
					organizationId: payload.organizationId,
					repositoryId: payload.repositoryId,
					pullNumber: payload.pullNumber
				})
			: [];
	if (payload.unmentioned && payload.kind === 'issue' && bodyFindings.length === 0) {
		log.info('conversation comment without a mention and no open body findings, skipping');
		return;
	}

	const connection = await connectRepository(ctx, payload.repositoryId);
	if (!connection) return;
	const { octokit, ref } = connection;

	const threadOf = () =>
		payload.kind === 'review'
			? getReviewThread(
					octokit,
					ref,
					payload.pullNumber,
					payload.rootCommentId ?? payload.commentId
				)
			: getRecentIssueComments(octokit, ref, payload.pullNumber);
	// A reply without a mention is answered only when it replies to Hansi. Checked before the 👀,
	// so people talking among themselves in a review thread see nothing from Hansi.
	const early = payload.unmentioned || bodyFindings.length > 0 ? await threadOf() : undefined;
	if (
		early &&
		payload.kind === 'review' &&
		!repliesToBot(early, payload.commentId, connection.mention)
	) {
		log.info('review-thread reply is not to Hansi, skipping');
		return;
	}
	// The comment being answered can settle a body-listed finding by quoting its title or line.
	const answered = early?.find((comment) => comment.id === payload.commentId)?.body ?? '';
	const named = findingsNamedIn(answered, bodyFindings, { mentioned: !payload.unmentioned });
	if (payload.unmentioned && payload.kind === 'issue' && named.length === 0) {
		log.info('conversation comment does not name an open finding, skipping');
		return;
	}

	if (job.attempts === 1) {
		await acknowledgeComment(octokit, ref, { id: payload.commentId, kind: payload.kind }).catch(
			(error) => log.warn({ err: error }, 'could not react to comment')
		);
	}

	const files = { repository: connection.repository.fullName, headSha: '' };
	const reply = async (body: string) => {
		const text = files.headSha ? absolutizeLinks(body, files.repository, files.headSha) : body;
		if (payload.kind === 'review') {
			await replyToReviewComment(
				octokit,
				ref,
				payload.pullNumber,
				payload.rootCommentId ?? payload.commentId,
				text
			);
		} else {
			await createIssueComment(octokit, ref, payload.pullNumber, text);
		}
	};

	try {
		const pr = await getPullRequest(octokit, ref, payload.pullNumber);
		files.headSha = pr.headSha;
		// Settings and guidelines come from the base branch, which the PR author cannot change.
		const { config } = parseRepoConfig(
			await getFileContent(octokit, ref, REPO_CONFIG_FILE, pr.baseSha)
		);

		const comments = early ?? (await threadOf());
		const thread: ThreadMessage[] = comments.map((c) => ({
			author: c.author,
			body: c.body,
			fromBot: c.isBot
		}));
		const root = comments[0];
		const bodyFinding = named[0];
		const focus =
			payload.kind === 'review' && root?.path
				? { path: root.path, line: root.line ?? undefined, diffHunk: root.diffHunk }
				: bodyFinding
					? { path: bodyFinding.path, line: bodyFinding.endLine }
					: undefined;

		// Replies on a finding Hansi posted can resolve or dismiss that finding.
		const finding: ChatFindingRow | undefined =
			(await loadChatFinding(db, payload.organizationId, payload.rootCommentId)) ?? bodyFinding;
		const findingIds = finding ? (named.length ? named.map((f) => f.id) : [finding.id]) : [];

		let settled = false;
		const { review: model } = await loadModels(ctx, payload.organizationId);
		// Each answer is its own trace in PostHog's LLM analytics.
		const usage = await createUsageRecorder(ctx, {
			organizationId: payload.organizationId,
			traceId: job.id
		});
		const learnings = await loadLearnings(db, payload.organizationId, payload.repositoryId);

		const token = await getInstallationToken(octokit);
		const useSandbox = await sandboxEnabled(db, payload.organizationId);
		const answer = await withWorkdir(env, async (repoDir) => {
			const diff = await checkoutPullRequest({
				dir: repoDir,
				cloneUrl: pr.cloneUrl,
				token,
				pullNumber: pr.number,
				baseSha: pr.baseSha,
				headSha: pr.headSha
			});
			// Most replies need no commands, so the sandbox starts only when the first one runs.
			const sandbox = useSandbox
				? lazySandbox(() =>
						openSandbox({
							env,
							config,
							repoDir,
							name: `hansi-chat-${job.id}`,
							emit: () => {},
							log
						})
					)
				: undefined;
			return runChat({
				repoDir,
				repository: files.repository,
				headSha: pr.headSha,
				pullRequest: pr,
				diff,
				thread,
				focus,
				learnings,
				trustedSource: { ref: pr.baseSha, token },
				language: config.language,
				...chatReplyFields(payload, finding),
				model,
				onModelCall: usage.record,
				onModelError: usage.recordError,
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
								.where(inArray(schema.reviewFindings.id, findingIds));
							settled = true;
						}
					: undefined,
				sandbox: sandbox?.runner
			}).finally(() => sandbox?.close());
		});

		await reply(answer);
		// A finding settled in the conversation (fixed, or intended) closes its thread after the answer.
		if (settled) {
			if (payload.rootCommentId) {
				await resolveReviewThreads(octokit, ref, payload.pullNumber, [payload.rootCommentId]).catch(
					(error) => log.warn({ err: error }, 'could not resolve thread')
				);
			}
			// Keep the PR summary's open-finding list and tier in sync with the dismissal.
			await refreshSummaryAfterSettlement({
				db,
				env,
				connection,
				organizationId: payload.organizationId,
				repositoryId: payload.repositoryId,
				pullNumber: payload.pullNumber,
				blockingSeverity: blockingSeverity(config),
				log
			}).catch((error) => log.warn({ err: error }, 'could not refresh summary after settlement'));
		}
		log.info('chat reply posted');
	} catch (error) {
		// Tell the person the answer failed, once retries are exhausted. The reply is fixed:
		// the error can name a provider or include request details, and it stays in the logs.
		const notice = chatFailureReply(job);
		if (notice) await reply(notice).catch(() => {});
		throw error;
	}
}
