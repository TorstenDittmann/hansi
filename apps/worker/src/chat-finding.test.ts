import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { chatReplyFields, loadChatFinding } from './chat-finding';

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
