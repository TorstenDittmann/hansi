export function formatCost(usd: number | null | undefined) {
	if (usd === null || usd === undefined) return '–';
	if (usd === 0) return '$0';
	return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Fixed English, UTC, so the server HTML and the browser render the same string. */
export function formatDate(value: Date | string | number | null | undefined) {
	if (!value) return '–';
	const date = new Date(value);
	const hours = date.getUTCHours();
	const minutes = String(date.getUTCMinutes()).padStart(2, '0');
	const hour12 = hours % 12 || 12;
	const suffix = hours < 12 ? 'AM' : 'PM';
	const month = months[date.getUTCMonth()];
	const day = date.getUTCDate();
	const year = date.getUTCFullYear();
	return `${month} ${day}, ${year}, ${hour12}:${minutes} ${suffix}`;
}

/** `YYYY-MM-DD` as `Sep 28`, read from the string so it does not depend on timezone or locale. */
export function formatDay(day: string) {
	return `${months[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
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
