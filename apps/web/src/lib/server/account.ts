import { schema, type Database } from '@hans/db';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';

function isOwner(role: string) {
	return role.split(',').includes('owner');
}

/**
 * Before hard-deleting a user: remove organizations they alone belong to (so their reviews and
 * keys don't orphan), and refuse if they are the last owner of an organization that still has
 * other members — those need a new owner first.
 */
export async function prepareAccountDeletion(db: Database, userId: string) {
	const memberships = await db.select().from(schema.member).where(eq(schema.member.userId, userId));

	for (const membership of memberships) {
		const members = await db
			.select()
			.from(schema.member)
			.where(eq(schema.member.organizationId, membership.organizationId));

		if (members.length === 1) {
			await db
				.delete(schema.organization)
				.where(eq(schema.organization.id, membership.organizationId));
			continue;
		}

		if (!isOwner(membership.role)) continue;

		const otherOwners = members.filter((m) => m.userId !== userId && isOwner(m.role));
		if (otherOwners.length > 0) continue;

		const [organization] = await db
			.select({ name: schema.organization.name })
			.from(schema.organization)
			.where(eq(schema.organization.id, membership.organizationId));
		throw new APIError('BAD_REQUEST', {
			message: `Transfer ownership of "${organization?.name ?? 'organization'}" or remove its other members before deleting your account.`
		});
	}
}
