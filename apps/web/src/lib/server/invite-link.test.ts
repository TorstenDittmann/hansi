import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { and, eq } from 'drizzle-orm';
import {
	acceptInviteLink,
	canManageInviteLinks,
	createInviteLink,
	findActiveInviteLink,
	inviteLinkUrl,
	inviteTokenFromCookie,
	revokeInviteLink
} from './invite-link';

async function setup() {
	const { db } = await createTestDatabase();
	const now = new Date();
	await db.insert(schema.user).values([
		{
			id: 'user-a',
			name: 'Ada',
			email: 'ada@example.com',
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'user-b',
			name: 'Bob',
			email: 'bob@example.com',
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		}
	]);
	await db.insert(schema.organization).values({
		id: 'org-1',
		name: 'Acme',
		slug: 'acme',
		createdAt: now
	});
	return db;
}

test('owners and admins can manage invite links', () => {
	expect(canManageInviteLinks('owner')).toBe(true);
	expect(canManageInviteLinks('admin')).toBe(true);
	expect(canManageInviteLinks('owner,admin')).toBe(true);
	expect(canManageInviteLinks('member')).toBe(false);
	expect(canManageInviteLinks(null)).toBe(false);
});

test('invite URLs use the public app origin', () => {
	expect(inviteLinkUrl('https://hansi.example/', 'abc')).toBe('https://hansi.example/invite/abc');
});

test('reads the invite token from a cookie header', () => {
	expect(inviteTokenFromCookie(null)).toBeNull();
	expect(inviteTokenFromCookie('other=1')).toBeNull();
	expect(inviteTokenFromCookie('other=1; hansi_invite=abc_def-123')).toBe('abc_def-123');
	expect(inviteTokenFromCookie('hansi_invite=a%2Bb')).toBe('a+b');
});

test('accept joins a new user and a second visit does not duplicate membership', async () => {
	const db = await setup();
	const link = await createInviteLink(db, 'org-1', 'user-a');

	expect((await acceptInviteLink(db, 'user-b', link.token))?.organizationId).toBe('org-1');
	expect((await acceptInviteLink(db, 'user-b', link.token))?.organizationId).toBe('org-1');

	const members = await db.select().from(schema.member).where(eq(schema.member.userId, 'user-b'));
	expect(members).toHaveLength(1);
	expect(members[0]?.role).toBe('member');
});

test('accept leaves an existing role unchanged', async () => {
	const db = await setup();
	const now = new Date();
	await db.insert(schema.member).values({
		id: 'm-owner',
		organizationId: 'org-1',
		userId: 'user-a',
		role: 'owner',
		createdAt: now
	});
	const link = await createInviteLink(db, 'org-1', 'user-a');
	await acceptInviteLink(db, 'user-a', link.token);

	const members = await db.select().from(schema.member).where(eq(schema.member.userId, 'user-a'));
	expect(members).toHaveLength(1);
	expect(members[0]?.role).toBe('owner');
});

test('a revoked or unknown token does not join', async () => {
	const db = await setup();
	const link = await createInviteLink(db, 'org-1', 'user-a');
	await revokeInviteLink(db, 'org-1');

	expect(await findActiveInviteLink(db, link.token)).toBeNull();
	expect(await acceptInviteLink(db, 'user-b', link.token)).toBeNull();
	expect(await acceptInviteLink(db, 'user-b', 'missing')).toBeNull();
	expect(await db.select().from(schema.member)).toHaveLength(0);
});

test('creating a link revokes the previous one', async () => {
	const db = await setup();
	const first = await createInviteLink(db, 'org-1', 'user-a');
	const second = await createInviteLink(db, 'org-1', 'user-a');

	expect(await findActiveInviteLink(db, first.token)).toBeNull();
	expect((await findActiveInviteLink(db, second.token))?.id).toBe(second.id);
	const active = await db
		.select()
		.from(schema.organizationInviteLink)
		.where(
			and(
				eq(schema.organizationInviteLink.organizationId, 'org-1'),
				eq(schema.organizationInviteLink.id, second.id)
			)
		);
	expect(active[0]?.revokedAt).toBeNull();
});
