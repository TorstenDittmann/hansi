import { schema, type Database } from '@hans/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

export interface ChatFindingRow {
	id: string;
	severity: string;
	category: string;
	title: string;
}

/** The finding a review-thread reply is about, or nothing when the comment is not on one. */
export async function loadChatFinding(
	db: Database,
	organizationId: string,
	rootCommentId: number | undefined
): Promise<ChatFindingRow | undefined> {
	if (!rootCommentId) return undefined;
	const [finding] = await db
		.select({
			id: schema.reviewFindings.id,
			severity: schema.reviewFindings.severity,
			category: schema.reviewFindings.category,
			title: schema.reviewFindings.title
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(
			and(
				eq(schema.reviewFindings.githubCommentId, rootCommentId),
				eq(schema.reviews.organizationId, organizationId)
			)
		);
	return finding;
}

/** Association and finding fields `runChat` uses to choose how hard to push back. */
export function chatReplyFields(
	payload: { authorAssociation?: string },
	finding: Pick<ChatFindingRow, 'severity' | 'category' | 'title'> | undefined
): {
	authorAssociation: string;
	finding?: { severity: string; category: string; title: string };
} {
	return {
		authorAssociation: payload.authorAssociation ?? '',
		...(finding
			? {
					finding: {
						severity: finding.severity,
						category: finding.category,
						title: finding.title
					}
				}
			: {})
	};
}

export interface BodyFindingRow extends ChatFindingRow {
	path: string;
	startLine: number;
	endLine: number;
}

/**
 * Open findings on a pull request that GitHub would not take inline, so they sit in the review
 * body with no thread to reply in. A conversation comment is the only way to answer them.
 */
export async function loadOpenBodyFindings(
	db: Database,
	input: { organizationId: string; repositoryId: number; pullNumber: number }
): Promise<BodyFindingRow[]> {
	return db
		.select({
			id: schema.reviewFindings.id,
			severity: schema.reviewFindings.severity,
			category: schema.reviewFindings.category,
			title: schema.reviewFindings.title,
			path: schema.reviewFindings.path,
			startLine: schema.reviewFindings.startLine,
			endLine: schema.reviewFindings.endLine
		})
		.from(schema.reviewFindings)
		.innerJoin(schema.reviews, eq(schema.reviews.id, schema.reviewFindings.reviewId))
		.where(
			and(
				eq(schema.reviews.organizationId, input.organizationId),
				eq(schema.reviews.repositoryId, input.repositoryId),
				eq(schema.reviews.pullNumber, input.pullNumber),
				eq(schema.reviews.status, 'completed'),
				eq(schema.reviewFindings.status, 'posted'),
				isNull(schema.reviewFindings.githubCommentId)
			)
		)
		.orderBy(desc(schema.reviewFindings.createdAt))
		.limit(50);
}

const normalize = (text: string) =>
	text
		.toLowerCase()
		.replace(/[`*_"“”]/g, '')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * The body-listed finding a conversation comment answers: the one whose title or `path:line` it
 * quotes. With a mention and a single open finding, a comment that names none is about that one.
 * Empty when the comment names none, or names several different ones. The same finding can come
 * back from several reviews of one pull request, so every copy of it is returned.
 */
export function findingsNamedIn<T extends BodyFindingRow>(
	comment: string,
	findings: readonly T[],
	options: { mentioned: boolean }
): T[] {
	const text = normalize(comment);
	const named = findings.filter((finding) => {
		if (text.includes(normalize(finding.title))) return true;
		const path = normalize(finding.path);
		for (let line = finding.startLine; line <= finding.endLine; line++) {
			if (text.includes(`${path}:${line}`) || text.includes(`${path}#l${line}`)) return true;
		}
		return false;
	});
	const titles = new Set(named.map((finding) => normalize(finding.title)));
	if (titles.size === 1) return named;
	const only = new Set(findings.map((finding) => normalize(finding.title)));
	if (titles.size === 0 && options.mentioned && only.size === 1) return [...findings];
	return [];
}
