/** Page size for the reviews list. The overview keeps a shorter recent slice. */
export const REVIEW_PAGE_SIZE = 25;

/** Trim a search box value and treat a leading `#` as a pull request number. */
export function normalizeReviewQuery(value: string | null | undefined): string {
	return (value ?? '').trim().replace(/^#/, '');
}

/** A `LIKE` pattern that matches `value` as a literal substring (`%`, `_`, and `\` included). */
export function likeContains(value: string): string {
	return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

export function reviewPageCount(total: number, pageSize = REVIEW_PAGE_SIZE): number {
	return Math.max(1, Math.ceil(total / pageSize));
}

/** 1-based page, clamped to the pages that exist for `total`. Non-integers become page 1. */
export function clampReviewPage(
	requested: number,
	total: number,
	pageSize = REVIEW_PAGE_SIZE
): number {
	const pages = reviewPageCount(total, pageSize);
	const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
	return Math.min(page, pages);
}

export function reviewSearch(filters: {
	query?: string;
	repository?: string;
	status?: string;
	page?: number;
}): string {
	const params = new URLSearchParams();
	const query = normalizeReviewQuery(filters.query);
	const repository = filters.repository?.trim() ?? '';
	if (query) params.set('q', query);
	if (repository) params.set('repo', repository);
	if (filters.status) params.set('status', filters.status);
	if (filters.page && filters.page > 1) params.set('page', String(filters.page));
	const qs = params.toString();
	return qs ? `?${qs}` : '';
}

/**
 * Normalized list filters from the URL. `filtersDirty` is true when the raw params are not the
 * canonical form (whitespace, a leading `#`, or an unknown status) and the page should redirect.
 * Page clamping needs the result count, so it stays with the caller.
 */
export function parseReviewFilters(
	input: {
		query: string | null;
		repository: string | null;
		status: string | null;
		page: string | null;
	},
	allowedStatuses: readonly string[]
) {
	const query = normalizeReviewQuery(input.query);
	const repository = (input.repository ?? '').trim();
	const status = input.status && allowedStatuses.includes(input.status) ? input.status : '';
	const requested = input.page === null || input.page === '' ? 1 : Number(input.page);
	const filtersDirty =
		(input.query ?? '') !== query ||
		(input.repository ?? '') !== repository ||
		(input.status ?? '') !== status;
	return { query, repository, status, requested, filtersDirty };
}
