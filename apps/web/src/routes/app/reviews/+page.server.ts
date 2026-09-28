import { redirect } from '@sveltejs/kit';
import { schema, type ReviewStatus } from '@hans/db';
import { countReviews, listReviewedRepositories, listReviews } from '$lib/server/data';
import { REVIEW_PAGE_SIZE, clampReviewPage, parseReviewFilters, reviewSearch } from '$lib/reviews';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { organization } = await parent();
	const parsed = parseReviewFilters(
		{
			query: url.searchParams.get('q'),
			repository: url.searchParams.get('repo'),
			status: url.searchParams.get('status'),
			page: url.searchParams.get('page')
		},
		schema.reviewStatuses
	);
	const filters = {
		query: parsed.query,
		repository: parsed.repository,
		status: (parsed.status || undefined) as ReviewStatus | undefined
	};
	const [total, repositories] = await Promise.all([
		countReviews(organization.id, filters),
		listReviewedRepositories(organization.id)
	]);
	const page = clampReviewPage(parsed.requested, total);
	const search = reviewSearch({ ...parsed, page });
	const canonicalPage = page > 1 ? String(page) : '';
	if (parsed.filtersDirty || (url.searchParams.get('page') ?? '') !== canonicalPage) {
		redirect(303, `/app/reviews${search}`);
	}

	const reviews = await listReviews(organization.id, {
		...filters,
		limit: REVIEW_PAGE_SIZE,
		offset: (page - 1) * REVIEW_PAGE_SIZE
	});
	return {
		reviews,
		repositories,
		total,
		page,
		pages: Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)),
		pageSize: REVIEW_PAGE_SIZE,
		query: parsed.query,
		repository: parsed.repository,
		status: parsed.status,
		statuses: schema.reviewStatuses,
		title: 'Reviews · Hansi'
	};
};
