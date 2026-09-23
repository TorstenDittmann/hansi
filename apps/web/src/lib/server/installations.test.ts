import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { eq } from 'drizzle-orm';
import { upsertInstallation } from './installations';

const installation = { id: 1, accountLogin: 'acme', accountType: 'Organization' };

async function setup() {
	const { db } = await createTestDatabase();
	const now = new Date();
	for (const id of ['org-a', 'org-b'])
		await db.insert(schema.organization).values({ id, name: id, slug: id, createdAt: now });
	const owner = async () =>
		(
			await db
				.select({ organizationId: schema.githubInstallations.organizationId })
				.from(schema.githubInstallations)
				.where(eq(schema.githubInstallations.id, 1))
		)[0]?.organizationId;
	return { db, owner };
}

test('an unowned installation is claimed by the organization that links it', async () => {
	const { db, owner } = await setup();
	await upsertInstallation(db, installation); // webhook: no organization yet
	expect(await upsertInstallation(db, installation, 'org-a')).toBe('org-a');
	expect(await owner()).toBe('org-a');
});

test('another organization cannot take an installation that is already owned', async () => {
	const { db, owner } = await setup();
	await upsertInstallation(db, installation, 'org-a');
	expect(await upsertInstallation(db, installation, 'org-b')).toBe('org-a');
	expect(await owner()).toBe('org-a');
});

test('webhook updates keep the owner', async () => {
	const { db, owner } = await setup();
	await upsertInstallation(db, installation, 'org-a');
	await upsertInstallation(db, { ...installation, accountLogin: 'acme-renamed' });
	expect(await owner()).toBe('org-a');
});

test('once disconnected, another organization can claim it', async () => {
	const { db, owner } = await setup();
	await upsertInstallation(db, installation, 'org-a');
	await db.update(schema.githubInstallations).set({ organizationId: null });
	expect(await upsertInstallation(db, installation, 'org-b')).toBe('org-b');
	expect(await owner()).toBe('org-b');
});
