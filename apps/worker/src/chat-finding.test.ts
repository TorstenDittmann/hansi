import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import {
	chatReplyFields,
	findingsNamedIn,
	loadChatFinding,
	loadOpenBodyFindings
} from './chat-finding';

const now = new Date('2026-09-01T00:00:00Z');

async function seed() {
	const { db } = await createTestDatabase();
	await db.insert(schema.organization).values({
		id: 'org-a',
		name: 'A',
		slug: 'a',
		createdAt: now
	});
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-a',
		accountLogin: 'appwrite',
		accountType: 'Organization'
	});
	await db.insert(schema.repositories).values({
		id: 10,
		installationId: 1,
		fullName: 'appwrite/appwrite',
		private: false,
		enabled: true
	});
	await db.insert(schema.reviews).values({
		id: 'review-1',
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber: 14206,
		headSha: '9e7020e',
		status: 'completed',
		trigger: 'synchronize',
		createdAt: now
	});
	await db.insert(schema.reviewFindings).values({
		id: 'finding-1',
		reviewId: 'review-1',
		path: 'tests/unit/General/ScopesTest.php',
		startLine: 33,
		endLine: 36,
		severity: 'minor',
		category: 'testing',
		title: 'Keep config-contract checks outside the restricted unit tier',
		body: 'AGENTS.md limits tests/unit to local src libraries.',
		status: 'posted',
		githubCommentId: 4204630028
	});
	return db;
}

test('a thread reply loads the finding severity, category, and title', async () => {
	const db = await seed();
	const finding = await loadChatFinding(db, 'org-a', 4204630028);
	expect(finding).toEqual({
		id: 'finding-1',
		severity: 'minor',
		category: 'testing',
		title: 'Keep config-contract checks outside the restricted unit tier'
	});
	expect(await loadChatFinding(db, 'org-other', 4204630028)).toBeUndefined();
	expect(await loadChatFinding(db, 'org-a', undefined)).toBeUndefined();
});

test('chat reply fields pass the association and the finding through to runChat', async () => {
	const db = await seed();
	const finding = await loadChatFinding(db, 'org-a', 4204630028);
	expect(chatReplyFields({ authorAssociation: 'MEMBER' }, finding)).toEqual({
		authorAssociation: 'MEMBER',
		finding: {
			severity: 'minor',
			category: 'testing',
			title: 'Keep config-contract checks outside the restricted unit tier'
		}
	});
	expect(chatReplyFields({ authorAssociation: 'NONE' }, undefined)).toEqual({
		authorAssociation: 'NONE'
	});
	// A job queued before association was stored stays untrusted.
	expect(chatReplyFields({}, finding).authorAssociation).toBe('');
});

const rateWindow = {
	id: 'finding-body',
	severity: 'minor',
	category: 'bug',
	title: 'Keep range-based rate windows above 2m',
	path: 'dashboards/Edge/inbound-email.json',
	startLine: 394,
	endLine: 394
};

test('open findings listed in the review body load for their pull request only', async () => {
	const db = await seed();
	await db.insert(schema.reviewFindings).values([
		{ ...rateWindow, reviewId: 'review-1', body: 'p95 goes blank.', status: 'posted' },
		{
			...rateWindow,
			id: 'finding-body-dismissed',
			reviewId: 'review-1',
			body: 'p95 goes blank.',
			status: 'dismissed'
		}
	]);
	const pr = { organizationId: 'org-a', repositoryId: 10, pullNumber: 14206 };
	// The inline finding has a thread and is answered there.
	expect((await loadOpenBodyFindings(db, pr)).map((f) => f.id)).toEqual(['finding-body']);
	expect(await loadOpenBodyFindings(db, { ...pr, pullNumber: 1 })).toEqual([]);
	expect(await loadOpenBodyFindings(db, { ...pr, organizationId: 'org-other' })).toEqual([]);
});

test('a conversation comment names a body finding by its title or line', () => {
	const pushback =
		'On the 🟡 "Keep range-based rate windows above 2m" finding: I\'m keeping it as is.';
	expect(findingsNamedIn(pushback, [rateWindow], { mentioned: false })).toEqual([rateWindow]);
	expect(
		findingsNamedIn('`dashboards/Edge/inbound-email.json:394` is intended', [rateWindow], {
			mentioned: false
		})
	).toEqual([rateWindow]);
	expect(findingsNamedIn('Thanks, merging now.', [rateWindow], { mentioned: false })).toEqual([]);
});

test('a mention that names no finding is about the only open one', () => {
	const other = { ...rateWindow, id: 'finding-other', title: 'Label the ingress panel' };
	const again = { ...rateWindow, id: 'finding-again' };
	expect(
		findingsNamedIn('@hansi-codes this does not apply', [rateWindow], { mentioned: true })
	).toEqual([rateWindow]);
	// The same finding from an earlier review counts as one.
	expect(
		findingsNamedIn('@hansi-codes this does not apply', [rateWindow, again], { mentioned: true })
	).toEqual([rateWindow, again]);
	expect(
		findingsNamedIn('@hansi-codes this does not apply', [rateWindow, other], { mentioned: true })
	).toEqual([]);
	expect(
		findingsNamedIn(
			'Keep range-based rate windows above 2m and Label the ingress panel',
			[rateWindow, other],
			{ mentioned: false }
		)
	).toEqual([]);
});
