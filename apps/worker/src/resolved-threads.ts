import { schema, type Database } from '@hans/db';
import { hasWriteAccess, listReviewThreads, type ReviewThread } from '@hans/github';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { RepositoryConnection } from './shared';

/**
 * Open findings whose GitHub thread a person resolved, with who resolved it.
 *
 * Hansi resolves threads it fixed itself, and those findings are already marked resolved, so a
 * resolution by the bot is ignored here. Write access is checked by the caller.
 */
export function threadsResolvedByPeople(
	findings: { id: string; githubCommentId: number }[],
	threads: ReviewThread[],
	botLogin: string
): { findingId: string; resolvedBy: string }[] {
	const bot = botLogin.toLowerCase();
	const byRoot = new Map(
		threads
			.filter((t) => t.isResolved && t.resolvedBy && t.resolvedBy.toLowerCase() !== bot)
			.map((t) => [t.rootCommentId, t.resolvedBy!] as const)
	);
	return findings.flatMap((f) => {
		const resolvedBy = byRoot.get(f.githubCommentId);
		return resolvedBy ? [{ findingId: f.id, resolvedBy }] : [];
	});
}

/**
 * Dismisses open findings whose thread someone with write access resolved on GitHub.
 *
 * Resolving the thread is how a maintainer closes a discussion. Without this, the next review
 * still saw the finding as open, checked whether the code "fixed" it, and kept it open, so the
 * grade, the summary, and the verdict ignored the decision. Dismissed findings are also not
 * reported again. Returns how many findings it dismissed.
 */
export async function dismissFindingsResolvedOnGitHub(
	db: Database,
	connection: RepositoryConnection,
	review: { repositoryId: number; pullNumber: number },
	log: Logger
): Promise<number> {
	const open = await db
		.select({
			id: schema.reviewFindings.id,
			githubCommentId: schema.reviewFindings.githubCommentId
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(
			and(
				eq(schema.reviews.repositoryId, review.repositoryId),
				eq(schema.reviews.pullNumber, review.pullNumber),
				eq(schema.reviews.status, 'completed'),
				eq(schema.reviewFindings.status, 'posted'),
				isNotNull(schema.reviewFindings.githubCommentId)
			)
		);
	if (open.length === 0) return 0;

	const { octokit, ref, mention } = connection;
	let threads: ReviewThread[];
	try {
		threads = await listReviewThreads(octokit, ref, review.pullNumber);
	} catch (error) {
		log.warn({ err: error }, 'could not read review threads');
		return 0;
	}
	const candidates = threadsResolvedByPeople(
		open.map((f) => ({ id: f.id, githubCommentId: f.githubCommentId! })),
		threads,
		`${mention.replace(/^@/, '')}[bot]`
	);

	// Anyone who can comment may be able to resolve a thread, including the PR author. Only a
	// person who can write to the repository settles a finding this way.
	const writers = new Map<string, boolean>();
	let dismissed = 0;
	for (const { findingId, resolvedBy } of candidates) {
		if (!writers.has(resolvedBy)) {
			writers.set(resolvedBy, await hasWriteAccess(octokit, ref, resolvedBy));
		}
		if (!writers.get(resolvedBy)) continue;
		await db
			.update(schema.reviewFindings)
			.set({ status: 'dismissed', dropReason: `Thread resolved on GitHub by @${resolvedBy}` })
			.where(
				and(eq(schema.reviewFindings.id, findingId), eq(schema.reviewFindings.status, 'posted'))
			);
		dismissed++;
	}
	if (dismissed) log.info({ dismissed }, 'dismissed findings whose thread was resolved on GitHub');
	return dismissed;
}
