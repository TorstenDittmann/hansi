import { schema } from '@hans/db';
import { classifyMention, verifyWebhookSignature } from '@hans/github';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getContext, getGitHubCredentials } from './context';
import { removeRepositories, upsertInstallation, upsertRepositories } from './installations';
import { enqueueChat, enqueueReview } from './jobs';

// Only the payload fields Hansi reads. Full types: @octokit/openapi-webhooks-types.
interface Account {
	login: string;
	type: string;
}
interface Repo {
	id: number;
	full_name: string;
	private: boolean;
}
type Payload = {
	action?: string;
	installation?: { id: number; account: Account };
	repositories?: Repo[];
	repositories_added?: Repo[];
	repositories_removed?: Repo[];
	repository?: Repo;
	pull_request?: { number: number; draft: boolean; head: { sha: string } };
	issue?: { number: number; pull_request?: unknown };
	comment?: {
		id: number;
		body: string;
		html_url: string;
		author_association: string;
		user: { login: string; type: string };
		/** Review comments only: the thread's first comment when this is a reply. */
		in_reply_to_id?: number;
	};
};

/** Commenters allowed to trigger a review: BYOK keys are spent on every review. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export async function handleGitHubWebhook(request: Request): Promise<Response> {
	const credentials = await getGitHubCredentials();
	if (!credentials) return new Response('GitHub App not configured', { status: 503 });

	// Verify against the raw body, before parsing.
	const rawBody = await request.text();
	const valid = await verifyWebhookSignature(
		credentials,
		rawBody,
		request.headers.get('x-hub-signature-256')
	);
	if (!valid) return new Response('Invalid signature', { status: 401 });

	const event = request.headers.get('x-github-event') ?? 'unknown';
	const deliveryId = request.headers.get('x-github-delivery');
	if (!deliveryId) return new Response('Missing delivery id', { status: 400 });

	const { db, queue } = await getContext();
	const inserted = await db
		.insert(schema.webhookDeliveries)
		.values({ id: deliveryId, event })
		.onConflictDoNothing()
		.returning();
	if (inserted.length === 0) return new Response('Duplicate delivery', { status: 200 });

	const payload = JSON.parse(rawBody) as Payload;
	const installation = payload.installation;

	switch (event) {
		case 'installation': {
			if (!installation) break;
			if (payload.action === 'deleted') {
				await db
					.delete(schema.githubInstallations)
					.where(eq(schema.githubInstallations.id, installation.id));
				break;
			}
			await upsertInstallation(db, {
				id: installation.id,
				accountLogin: installation.account.login,
				accountType: installation.account.type
			});
			if (payload.action === 'suspend' || payload.action === 'unsuspend') {
				await db
					.update(schema.githubInstallations)
					.set({ suspendedAt: payload.action === 'suspend' ? new Date() : null })
					.where(eq(schema.githubInstallations.id, installation.id));
			}
			await upsertRepositories(db, installation.id, (payload.repositories ?? []).map(toRepo));
			break;
		}

		case 'installation_repositories': {
			if (!installation) break;
			await upsertRepositories(db, installation.id, (payload.repositories_added ?? []).map(toRepo));
			await removeRepositories(
				db,
				(payload.repositories_removed ?? []).map((repo) => repo.id)
			);
			break;
		}

		case 'pull_request': {
			const pr = payload.pull_request;
			const action = payload.action ?? '';
			if (!pr || !payload.repository) break;
			if (!['opened', 'reopened', 'ready_for_review', 'synchronize'].includes(action)) break;

			const repo = await findActiveRepository(payload.repository.id);
			if (!repo) break;
			await enqueueReview(db, queue, {
				organizationId: repo.organizationId,
				repositoryId: repo.id,
				pullNumber: pr.number,
				headSha: pr.head.sha,
				trigger: action === 'synchronize' ? 'synchronize' : 'opened'
			});
			break;
		}

		case 'issue_comment':
		case 'pull_request_review_comment': {
			const { comment } = payload;
			const pullNumber =
				event === 'issue_comment'
					? payload.issue?.pull_request
						? payload.issue.number
						: undefined
					: payload.pull_request?.number;
			if (payload.action !== 'created' || !comment || !pullNumber || !payload.repository) break;
			// Every answer spends the workspace's API credits; only trusted people can ask.
			if (comment.user.type === 'Bot' || !TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
				break;
			}

			const repo = await findActiveRepository(payload.repository.id);
			if (!repo) break;

			const isReviewThread = event === 'pull_request_review_comment';
			const rootCommentId = isReviewThread ? (comment.in_reply_to_id ?? comment.id) : undefined;
			let intent = classifyMention(comment.body, credentials.slug);
			// Replying to one of Hansi's findings is a conversation, even without a mention.
			if (
				!intent &&
				rootCommentId &&
				(await isFindingComment(repo.organizationId, rootCommentId))
			) {
				intent = 'chat';
			}

			if (intent === 'review') {
				await enqueueReview(db, queue, {
					organizationId: repo.organizationId,
					repositoryId: repo.id,
					pullNumber,
					headSha: '',
					trigger: 'mention'
				});
			} else if (intent === 'chat') {
				await enqueueChat(queue, {
					organizationId: repo.organizationId,
					repositoryId: repo.id,
					pullNumber,
					commentId: comment.id,
					kind: isReviewThread ? 'review' : 'issue',
					rootCommentId,
					author: comment.user.login,
					commentUrl: comment.html_url
				});
			}
			break;
		}
	}

	return new Response('OK', { status: 202 });
}

/** Repository that is enabled, installed, not suspended, and claimed by an organization. */
async function findActiveRepository(repositoryId: number) {
	const { db } = await getContext();
	const [row] = await db
		.select({
			id: schema.repositories.id,
			organizationId: schema.githubInstallations.organizationId,
			suspendedAt: schema.githubInstallations.suspendedAt
		})
		.from(schema.repositories)
		.innerJoin(
			schema.githubInstallations,
			eq(schema.githubInstallations.id, schema.repositories.installationId)
		)
		.where(
			and(
				eq(schema.repositories.id, repositoryId),
				eq(schema.repositories.enabled, true),
				isNotNull(schema.githubInstallations.organizationId)
			)
		);
	if (!row?.organizationId || row.suspendedAt) return null;
	return { id: row.id, organizationId: row.organizationId };
}

/** Whether a GitHub review comment is one of the findings Hansi posted for this organization. */
async function isFindingComment(organizationId: string, commentId: number) {
	const { db } = await getContext();
	const [row] = await db
		.select({ id: schema.reviewFindings.id })
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(
			and(
				eq(schema.reviewFindings.githubCommentId, commentId),
				eq(schema.reviews.organizationId, organizationId)
			)
		)
		.limit(1);
	return !!row;
}

function toRepo(repo: Repo) {
	return { id: repo.id, fullName: repo.full_name, private: repo.private };
}
