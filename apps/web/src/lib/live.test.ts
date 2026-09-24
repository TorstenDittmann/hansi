import { describe, expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { eq } from 'drizzle-orm';
import {
	isLiveReviewStatus,
	pendingReviewMessage,
	pollWhileVisible,
	REVIEW_POLL_MS,
	reviewInvalidateKey,
	type VisibilityDocument
} from './live';

test('only queued and running reviews are live', () => {
	expect(isLiveReviewStatus('queued')).toBe(true);
	expect(isLiveReviewStatus('running')).toBe(true);
	for (const status of ['completed', 'failed', 'skipped', 'superseded']) {
		expect(isLiveReviewStatus(status)).toBe(false);
	}
});

test('empty-state copy matches the in-flight status', () => {
	expect(pendingReviewMessage('queued')).toBe('Waiting in queue…');
	expect(pendingReviewMessage('running')).toBe('Review in progress…');
	expect(pendingReviewMessage('completed')).toBeNull();
	expect(pendingReviewMessage('superseded')).toBeNull();
});

test('the invalidate key is scoped to the review so the app layout is not a dependency', () => {
	expect(reviewInvalidateKey('abc')).toBe('app:review:abc');
	expect(REVIEW_POLL_MS).toBe(2_000);
});

describe('pollWhileVisible', () => {
	test('polls on an interval while visible, pauses when hidden, and refreshes on return', () => {
		const { document, hide, show } = fakeDocument('visible');
		const { timers, advance } = fakeTimers();
		const refresh = counter();

		const stop = pollWhileVisible({
			refresh,
			intervalMs: 2_000,
			document,
			timers
		});

		advance(2_000);
		advance(2_000);
		expect(refresh.calls).toBe(2);

		hide();
		advance(10_000);
		expect(refresh.calls).toBe(2);

		show();
		expect(refresh.calls).toBe(3);
		advance(2_000);
		expect(refresh.calls).toBe(4);

		stop();
		advance(10_000);
		expect(refresh.calls).toBe(4);
	});

	test('does not poll while the tab starts hidden, then refreshes when it becomes visible', () => {
		const { document, show } = fakeDocument('hidden');
		const { timers, advance } = fakeTimers();
		const refresh = counter();

		pollWhileVisible({ refresh, intervalMs: 2_000, document, timers });
		advance(10_000);
		expect(refresh.calls).toBe(0);

		show();
		expect(refresh.calls).toBe(1);
		advance(2_000);
		expect(refresh.calls).toBe(2);
	});
});

describe('seeded review', () => {
	test('polling a running review stops once it is completed', async () => {
		const { db, id } = await seedReview('running');
		const { document } = fakeDocument('visible');
		const { timers, advance } = fakeTimers();
		const seen: string[] = [];

		const statusOf = async () => {
			const [row] = await db
				.select({ status: schema.reviews.status })
				.from(schema.reviews)
				.where(eq(schema.reviews.id, id));
			return row!.status;
		};

		let inflight = Promise.resolve();
		let stop = () => {};
		const follow = (status: string) => {
			stop();
			if (!isLiveReviewStatus(status)) return;
			stop = pollWhileVisible({
				intervalMs: 2_000,
				document,
				timers,
				refresh: () => {
					inflight = statusOf().then((next) => {
						seen.push(next);
						if (!isLiveReviewStatus(next)) stop();
					});
				}
			});
		};

		follow(await statusOf());
		advance(2_000);
		await inflight;
		expect(seen).toEqual(['running']);

		await db
			.update(schema.reviews)
			.set({ status: 'completed', finishedAt: new Date() })
			.where(eq(schema.reviews.id, id));
		advance(2_000);
		await inflight;
		expect(seen).toEqual(['running', 'completed']);

		advance(6_000);
		await inflight;
		expect(seen).toEqual(['running', 'completed']);
		expect(isLiveReviewStatus(await statusOf())).toBe(false);
	});

	test('superseded is terminal, same as completed', async () => {
		const { db, id } = await seedReview('queued');
		expect(isLiveReviewStatus('queued')).toBe(true);
		await db.update(schema.reviews).set({ status: 'superseded' }).where(eq(schema.reviews.id, id));
		const [row] = await db
			.select({ status: schema.reviews.status })
			.from(schema.reviews)
			.where(eq(schema.reviews.id, id));
		expect(isLiveReviewStatus(row!.status)).toBe(false);
	});
});

function counter() {
	const fn = () => {
		fn.calls += 1;
	};
	fn.calls = 0;
	return fn;
}

function fakeDocument(initial: Document['visibilityState']) {
	let visibilityState = initial;
	const listeners = new Set<() => void>();
	const document: VisibilityDocument = {
		get visibilityState() {
			return visibilityState;
		},
		addEventListener(type, listener) {
			if (type === 'visibilitychange') listeners.add(listener);
		},
		removeEventListener(type, listener) {
			if (type === 'visibilitychange') listeners.delete(listener);
		}
	};
	const set = (state: Document['visibilityState']) => {
		visibilityState = state;
		for (const listener of listeners) listener();
	};
	return { document, hide: () => set('hidden'), show: () => set('visible') };
}

function fakeTimers() {
	let now = 0;
	let nextId = 1;
	const intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
	const timers = {
		setInterval(handler: () => void, interval: number) {
			const id = nextId++;
			intervals.set(id, { fn: handler, ms: interval, next: now + interval });
			return id;
		},
		clearInterval(id: unknown) {
			intervals.delete(id as number);
		}
	};
	const advance = (ms: number) => {
		const target = now + ms;
		while (intervals.size) {
			let soonest: { id: number; next: number } | undefined;
			for (const [id, timer] of intervals) {
				if (!soonest || timer.next < soonest.next) soonest = { id, next: timer.next };
			}
			if (!soonest || soonest.next > target) break;
			now = soonest.next;
			const timer = intervals.get(soonest.id);
			if (!timer) continue;
			timer.next += timer.ms;
			timer.fn();
		}
		now = target;
	};
	return { timers, advance };
}

async function seedReview(status: 'queued' | 'running') {
	const { db } = await createTestDatabase();
	const now = new Date();
	await db.insert(schema.organization).values({
		id: 'org-1',
		name: 'Acme',
		slug: 'acme',
		createdAt: now
	});
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-1',
		accountLogin: 'acme',
		accountType: 'Organization'
	});
	await db.insert(schema.repositories).values({
		id: 10,
		installationId: 1,
		fullName: 'acme/api',
		private: false,
		enabled: true
	});
	const id = 'rev-1';
	await db.insert(schema.reviews).values({
		id,
		organizationId: 'org-1',
		repositoryId: 10,
		pullNumber: 42,
		headSha: 'abc123',
		status,
		trigger: 'opened',
		startedAt: status === 'running' ? now : null
	});
	return { db, id };
}
