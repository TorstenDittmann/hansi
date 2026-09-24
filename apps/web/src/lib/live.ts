/**
 * Live updates for in-flight reviews. The review detail page opens a `query.live` stream;
 * the server yields a fresh snapshot on an interval until the review is terminal or the
 * client disconnects (leaving the page, or hiding the tab).
 */

export const REVIEW_STREAM_MS = 2_000;

/** Queued and running reviews still change; everything else is terminal (including superseded). */
export function isLiveReviewStatus(status: string) {
	return status === 'queued' || status === 'running';
}

/** Copy for empty sections while a review has not finished. */
export function pendingReviewMessage(status: string) {
	if (status === 'queued') return 'Waiting in queue…';
	if (status === 'running') return 'Review in progress…';
	return null;
}

export function delay(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Yield snapshots from `read` while the review is queued or running. Stops after the first
 * terminal snapshot, when `read` returns null, or when `signal` aborts.
 */
export async function* streamReview<T extends { status: string }>(
	read: () => Promise<T | null>,
	options: {
		signal: AbortSignal;
		intervalMs?: number;
		sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	}
): AsyncGenerator<T> {
	const intervalMs = options.intervalMs ?? REVIEW_STREAM_MS;
	const sleep = options.sleep ?? delay;
	while (!options.signal.aborted) {
		const review = await read();
		if (!review) return;
		yield review;
		if (!isLiveReviewStatus(review.status)) return;
		await sleep(intervalMs, options.signal);
	}
}
