import { schema, type Database } from '@hans/db';
import { and, desc, eq, gte, notExists, sql } from 'drizzle-orm';

/**
 * What the organization's model calls cost: this and last calendar month (UTC), daily spend for
 * the last 30 days, and a breakdown by model and by repository over the same 30 days.
 * Review totals include skipped reviews.
 */
export async function costSummary(db: Database, organizationId: string, now = new Date()) {
	const { llmCalls, reviews, repositories } = schema;
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
	const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
	const inOrganization = eq(llmCalls.organizationId, organizationId);
	const cost = sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`;
	const day = sql<string>`date(${llmCalls.createdAt} / 1000, 'unixepoch')`;

	const [
		[month],
		[lastMonth],
		[reviewCount],
		daily,
		byModel,
		spendByRepository,
		skippedByRepository
	] = await Promise.all([
		db
			.select({
				cost,
				inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
				outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`,
				unpriced: sql<number>`sum(${llmCalls.costUsd} is null)`
			})
			.from(llmCalls)
			.where(and(inOrganization, gte(llmCalls.createdAt, monthStart))),
		db
			.select({ cost })
			.from(llmCalls)
			.where(
				and(
					inOrganization,
					gte(llmCalls.createdAt, lastMonthStart),
					sql`${llmCalls.createdAt} < ${monthStart.getTime()}`
				)
			),
		// Every review created this month, including skipped (drafts, nothing to review, disabled).
		db
			.select({ count: sql<number>`count(*)` })
			.from(reviews)
			.where(and(eq(reviews.organizationId, organizationId), gte(reviews.createdAt, monthStart))),
		db
			.select({ day, cost })
			.from(llmCalls)
			.where(and(inOrganization, gte(llmCalls.createdAt, since)))
			.groupBy(day),
		db
			.select({
				provider: llmCalls.provider,
				model: llmCalls.model,
				cost,
				calls: sql<number>`count(*)`,
				tokens: sql<number>`sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens})`
			})
			.from(llmCalls)
			.where(and(inOrganization, gte(llmCalls.createdAt, since)))
			.groupBy(llmCalls.provider, llmCalls.model)
			.orderBy(desc(cost)),
		db
			.select({
				repository: repositories.fullName,
				cost,
				reviews: sql<number>`count(distinct ${llmCalls.reviewId})`
			})
			.from(llmCalls)
			.innerJoin(reviews, eq(reviews.id, llmCalls.reviewId))
			.innerJoin(repositories, eq(repositories.id, reviews.repositoryId))
			.where(and(inOrganization, gte(llmCalls.createdAt, since)))
			.groupBy(repositories.fullName),
		// Skipped reviews often never call a model, so the spend query above misses them.
		db
			.select({
				repository: repositories.fullName,
				reviews: sql<number>`count(*)`
			})
			.from(reviews)
			.innerJoin(repositories, eq(repositories.id, reviews.repositoryId))
			.where(
				and(
					eq(reviews.organizationId, organizationId),
					eq(reviews.status, 'skipped'),
					gte(reviews.createdAt, since),
					notExists(
						db.select({ id: llmCalls.id }).from(llmCalls).where(eq(llmCalls.reviewId, reviews.id))
					)
				)
			)
			.groupBy(repositories.fullName)
	]);

	// One entry per day, including days without calls.
	const costByDay = new Map(daily.map((row) => [row.day, row.cost]));
	const days = Array.from({ length: 30 }, (_, i) => {
		const date = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
		return { day: date, cost: costByDay.get(date) ?? 0 };
	});

	return {
		month: { ...month!, reviews: Number(reviewCount!.count), unpriced: month!.unpriced ?? 0 },
		lastMonthCost: lastMonth!.cost,
		days,
		byModel,
		byRepository: repositoryBreakdown(spendByRepository, skippedByRepository)
	};
}

/** Spend by repository, with skipped reviews that never called a model added to the review count. */
function repositoryBreakdown(
	spend: { repository: string; cost: number; reviews: number }[],
	skipped: { repository: string; reviews: number }[]
) {
	const rows = new Map<string, { repository: string; cost: number; reviews: number }>();
	for (const row of spend) {
		rows.set(row.repository, {
			repository: row.repository,
			cost: Number(row.cost),
			reviews: Number(row.reviews)
		});
	}
	for (const row of skipped) {
		const reviews = Number(row.reviews);
		const existing = rows.get(row.repository);
		if (existing) existing.reviews += reviews;
		else rows.set(row.repository, { repository: row.repository, cost: 0, reviews });
	}
	return [...rows.values()].sort((a, b) => b.cost - a.cost || b.reviews - a.reviews).slice(0, 8);
}
