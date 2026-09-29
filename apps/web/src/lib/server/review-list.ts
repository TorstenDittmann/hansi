// Organization-scoped review lists. Every query takes `organizationId` and filters by it.
import { schema, type Database, type ReviewStatus } from '@hans/db';
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { likeContains, normalizeReviewQuery } from '../reviews';

export type ReviewListOptions = {
	/** Repository name fragment, or a pull request number (optional leading #). */
	query?: string;
	/** Exact `owner/name`. Combined with `query` when both are set. */
	repository?: string;
	status?: ReviewStatus;
	limit?: number;
	offset?: number;
};

const DEFAULT_LIMIT = 50;

function reviewWhere(
	organizationId: string,
	options: Pick<ReviewListOptions, 'query' | 'status' | 'repository'>
) {
	const filters: SQL[] = [eq(schema.reviews.organizationId, organizationId)];
	if (options.status) filters.push(eq(schema.reviews.status, options.status));

	const repository = options.repository?.trim();
	if (repository) filters.push(eq(schema.repositories.fullName, repository));

	const query = normalizeReviewQuery(options.query);
	if (query) {
		const name = sql`${schema.repositories.fullName} like ${likeContains(query)} escape '\\'`;
		const match = /^\d+$/.test(query)
			? or(name, eq(schema.reviews.pullNumber, Number(query)))
			: name;
		if (match) filters.push(match);
	}

	return and(...filters);
}

const posted = sql<number>`(select count(*) from ${schema.reviewFindings} where ${schema.reviewFindings.reviewId} = ${schema.reviews.id} and ${schema.reviewFindings.status} = 'posted')`;

export async function queryReviewList(
	db: Database,
	organizationId: string,
	options: ReviewListOptions = {}
) {
	const rows = await db
		.select({
			id: schema.reviews.id,
			repository: schema.repositories.fullName,
			pullNumber: schema.reviews.pullNumber,
			status: schema.reviews.status,
			verdict: schema.reviews.verdict,
			tier: schema.reviews.tier,
			costUsd: schema.reviews.costUsd,
			createdAt: schema.reviews.createdAt,
			finishedAt: schema.reviews.finishedAt,
			posted
		})
		.from(schema.reviews)
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(reviewWhere(organizationId, options))
		.orderBy(desc(schema.reviews.createdAt), desc(schema.reviews.id))
		.limit(options.limit ?? DEFAULT_LIMIT)
		.offset(options.offset ?? 0);
	return rows.map((row) => ({ ...row, posted: Number(row.posted) }));
}

export async function countReviewList(
	db: Database,
	organizationId: string,
	options: Pick<ReviewListOptions, 'query' | 'status' | 'repository'> = {}
) {
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(schema.reviews)
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(reviewWhere(organizationId, options));
	return Number(row?.count ?? 0);
}

/** Repository names that have at least one review, for the list filter. */
export async function listReviewedRepositoryNames(db: Database, organizationId: string) {
	const rows = await db
		.selectDistinct({ fullName: schema.repositories.fullName })
		.from(schema.reviews)
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(eq(schema.reviews.organizationId, organizationId))
		.orderBy(schema.repositories.fullName);
	return rows.map((row) => row.fullName);
}
