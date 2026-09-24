/**
 * Live updates for in-flight reviews. The dashboard has no push channel; the review detail page
 * re-runs its load function on a timer while the worker is still going.
 *
 * The named `depends` key keeps SvelteKit from refetching the app layout (orgs, app slug) each tick.
 */

export const REVIEW_POLL_MS = 2_000;

export function reviewInvalidateKey(reviewId: string) {
	return `app:review:${reviewId}`;
}

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

export type VisibilityDocument = {
	readonly visibilityState: Document['visibilityState'];
	addEventListener(type: 'visibilitychange', listener: () => void): void;
	removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

export type PollTimers = {
	setInterval: (handler: () => void, interval: number) => unknown;
	clearInterval: (id: unknown) => void;
};

/**
 * Call `refresh` every `intervalMs` while the tab is visible. Hidden tabs pause; becoming visible
 * again refreshes immediately and resumes. Returns a stop function (effect cleanup).
 */
export function pollWhileVisible(options: {
	refresh: () => unknown | Promise<unknown>;
	intervalMs?: number;
	document?: VisibilityDocument;
	timers?: PollTimers;
}): () => void {
	const { refresh, intervalMs = REVIEW_POLL_MS } = options;
	const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
	if (!doc) return () => {};

	const schedule = options.timers?.setInterval ?? setInterval;
	const cancel: (id: unknown) => void =
		options.timers?.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
	let timer: unknown;

	const stopTimer = () => {
		if (timer === undefined) return;
		cancel(timer);
		timer = undefined;
	};

	const startTimer = (immediate: boolean) => {
		if (timer !== undefined) return;
		if (immediate) void refresh();
		timer = schedule(() => void refresh(), intervalMs);
	};

	const onVisibilityChange = () => {
		if (doc.visibilityState === 'hidden') stopTimer();
		else startTimer(true);
	};

	if (doc.visibilityState !== 'hidden') startTimer(false);
	doc.addEventListener('visibilitychange', onVisibilityChange);

	return () => {
		stopTimer();
		doc.removeEventListener('visibilitychange', onVisibilityChange);
	};
}
