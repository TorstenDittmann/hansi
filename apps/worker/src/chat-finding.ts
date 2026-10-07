import { schema, type Database } from '@hans/db';
import { and, eq } from 'drizzle-orm';

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
