import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { eq } from 'drizzle-orm';
import { prepareAccountDeletion } from './account';

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
	await db.insert(schema.organization).values([
		{ id: 'org-solo', name: 'Solo', slug: 'solo', createdAt: now },
		{ id: 'org-shared', name: 'Shared', slug: 'shared', createdAt: now }
	]);
	return { db, now };
}

test('deletes organizations the user belongs to alone', async () => {
	const { db, now } = await setup();
	await db.insert(schema.member).values({
		id: 'm1',
		organizationId: 'org-solo',
		userId: 'user-a',
		role: 'owner',
		createdAt: now
	});

	await prepareAccountDeletion(db, 'user-a');

	const orgs = await db.select().from(schema.organization);
	expect(orgs.map((o) => o.id)).toEqual(['org-shared']);
});

test('refuses when the user is the last owner of an organization with other members', async () => {
	const { db, now } = await setup();
	await db.insert(schema.member).values([
		{
			id: 'm1',
			organizationId: 'org-shared',
			userId: 'user-a',
			role: 'owner',
			createdAt: now
		},
		{
			id: 'm2',
			organizationId: 'org-shared',
			userId: 'user-b',
			role: 'member',
			createdAt: now
		}
	]);

	await expect(prepareAccountDeletion(db, 'user-a')).rejects.toThrow(/Transfer ownership/);
	expect(
		(await db.select().from(schema.organization).where(eq(schema.organization.id, 'org-shared')))
			.length
	).toBe(1);
});

test('does not delete a solo organization when a shared-org ownership check fails', async () => {
	const { db, now } = await setup();
	await db.insert(schema.member).values([
		{
			id: 'm-solo',
			organizationId: 'org-solo',
			userId: 'user-a',
			role: 'owner',
			createdAt: now
		},
		{
			id: 'm-shared-a',
			organizationId: 'org-shared',
			userId: 'user-a',
			role: 'owner',
			createdAt: now
		},
		{
			id: 'm-shared-b',
			organizationId: 'org-shared',
			userId: 'user-b',
			role: 'member',
			createdAt: now
		}
	]);

	await expect(prepareAccountDeletion(db, 'user-a')).rejects.toThrow(/Transfer ownership/);
	const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);
	expect(orgs.map((o) => o.id).sort()).toEqual(['org-shared', 'org-solo']);
});

test('allows deletion when another owner remains', async () => {
	const { db, now } = await setup();
	await db.insert(schema.member).values([
		{
			id: 'm1',
			organizationId: 'org-shared',
			userId: 'user-a',
			role: 'owner',
			createdAt: now
		},
		{
			id: 'm2',
			organizationId: 'org-shared',
			userId: 'user-b',
			role: 'owner',
			createdAt: now
		}
	]);

	await prepareAccountDeletion(db, 'user-a');

	expect(
		(await db.select().from(schema.organization).where(eq(schema.organization.id, 'org-shared')))
			.length
	).toBe(1);
	expect(
		(await db.select().from(schema.member).where(eq(schema.member.organizationId, 'org-shared')))
			.length
	).toBe(2);
});
