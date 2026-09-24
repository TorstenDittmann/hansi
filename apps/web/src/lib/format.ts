export function formatCost(usd: number | null | undefined) {
	if (usd === null || usd === undefined) return '–';
	if (usd === 0) return '$0';
	return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function formatDate(value: Date | string | number | null | undefined) {
	if (!value) return '–';
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(value)
	);
}

/**
 * Elapsed time from `from` to `to`. When `to` is missing (a review still running), uses `now`
 * so the detail page can tick while `finishedAt` is null.
 */
export function formatDuration(
	from: Date | string | number | null | undefined,
	to: Date | string | number | null | undefined,
	now: Date | string | number = Date.now()
) {
	if (!from) return '–';
	const seconds = Math.max(
		0,
		Math.round((new Date(to ?? now).getTime() - new Date(from).getTime()) / 1000)
	);
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatTokens(value: number) {
	return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export { tierMeaning, verdictLabel } from '@hans/config';
