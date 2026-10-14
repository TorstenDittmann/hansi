import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import {
	mentionWantsSameHeadReply,
	otherPullReviews,
	sameHeadCoalesce,
	sameHeadSkipSummary,
	type SameHeadReview
} from './same-head';

const head = 'ff08776ef21c7c71d0e70879e7a9d4eaec748faf';
const newer = '8c9e11011094efa588f6d7a1f033328df470325c';

function review(status: SameHeadReview['status'], headSha = head): SameHeadReview {
	return { status, headSha };
}

test('a completed review of this commit skips the follow-up', () => {
	expect(sameHeadCoalesce(head, [review('completed')], 'synchronize')).toBe('already-reviewed');
});

test('an explicit review request re-reviews a commit that is already reviewed', () => {
	expect(sameHeadCoalesce(head, [review('completed')], 'mention')).toBeNull();
	expect(sameHeadCoalesce(head, [review('completed')], 'opened')).toBe('already-reviewed');
	expect(sameHeadCoalesce(head, [review('completed')], 'manual')).toBe('already-reviewed');
});

test('an explicit review request still waits for a running review of the same commit', () => {
	expect(sameHeadCoalesce(head, [review('running'), review('completed')], 'mention')).toBe(
		'in-flight'
	);
});

test('a running review of this commit skips the follow-up', () => {
	expect(sameHeadCoalesce(head, [review('running')], 'synchronize')).toBe('in-flight');
});

test('a completed review wins over one that is still running', () => {
	expect(sameHeadCoalesce(head, [review('running'), review('completed')], 'synchronize')).toBe(
		'already-reviewed'
	);
});

test('failed, skipped, superseded, and queued attempts still leave the commit to review', () => {
	for (const status of ['failed', 'skipped', 'superseded', 'queued'] as const) {
		expect(sameHeadCoalesce(head, [review(status)], 'synchronize')).toBeNull();
	}
});

test('a new commit is reviewed even when the previous one finished', () => {
	expect(
		sameHeadCoalesce(newer, [review('completed', head), review('running', head)], 'synchronize')
	).toBeNull();
});

test('an unresolved head is not treated as already reviewed', () => {
	expect(sameHeadCoalesce('', [review('completed', '')], 'synchronize')).toBeNull();
});

test('the skip summary names the short commit', () => {
	expect(sameHeadSkipSummary('already-reviewed', head)).toBe(
		"Already reviewed ff08776. No new commits since then, so I didn't post another review."
	);
	expect(sameHeadSkipSummary('in-flight', head)).toBe(
		"A review of ff08776 is already running, so I didn't start another one."
	);
});

test('only a mention gets a reply when the commit is already covered', () => {
	expect(mentionWantsSameHeadReply('mention')).toBe(true);
	for (const trigger of ['opened', 'synchronize', 'manual']) {
		expect(mentionWantsSameHeadReply(trigger)).toBe(false);
	}
});

test('the lookup is limited to other reviews of the same pull request', async () => {
	const { db } = await createTestDatabase();
	const now = new Date('2026-10-07T09:52:00Z');
	await db
		.insert(schema.organization)
		.values({ id: 'org-a', name: 'A', slug: 'a', createdAt: now });
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-a',
		accountLogin: 'acme',
		accountType: 'Organization'
	});
	await db.insert(schema.repositories).values({
		id: 10,
		installationId: 1,
		fullName: 'acme/web',
		private: false,
		enabled: true
	});

	const row = (
		id: string,
		pullNumber: number,
		headSha: string,
		status: SameHeadReview['status']
	) => ({
		id,
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber,
		headSha,
		status,
		trigger: 'opened' as const,
		createdAt: now
	});
	await db
		.insert(schema.reviews)
		.values([
			row('self', 7, '', 'queued'),
			row('done', 7, head, 'completed'),
			row('busy', 7, newer, 'running'),
			row('other-pr', 8, head, 'completed')
		]);

	const others = await otherPullReviews(db, { id: 'self', repositoryId: 10, pullNumber: 7 });
	expect(others).toHaveLength(2);
	expect(others).toContainEqual({ headSha: head, status: 'completed' });
	expect(others).toContainEqual({ headSha: newer, status: 'running' });
	expect(sameHeadCoalesce(head, others, 'synchronize')).toBe('already-reviewed');
	expect(sameHeadCoalesce(newer, others, 'synchronize')).toBe('in-flight');
	expect(
		sameHeadCoalesce('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', others, 'synchronize')
	).toBeNull();
});
