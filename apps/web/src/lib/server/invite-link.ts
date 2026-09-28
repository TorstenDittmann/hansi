import { schema, type Database } from '@hans/db';
import { and, eq, isNull } from 'drizzle-orm';

/** Cookie set before GitHub sign-in so a restricted instance can admit the new account. */
export const INVITE_COOKIE = 'hansi_invite';

export function canManageInviteLinks(role: string | null | undefined) {
	const roles = role?.split(',') ?? [];
	return roles.includes('owner') || roles.includes('admin');
}

/** 32 random bytes, base64url. Long enough that the link itself is the secret. */
export function newInviteToken() {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export function inviteLinkUrl(appUrl: string, token: string) {
	return `${appUrl.replace(/\/$/, '')}/invite/${encodeURIComponent(token)}`;
}

export function inviteTokenFromCookie(cookieHeader: string | null | undefined) {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(';')) {
		const separator = part.indexOf('=');
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== INVITE_COOKIE) continue;
		const raw = part.slice(separator + 1).trim();
		if (!raw) return null;
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}
	return null;
}

export async function findActiveInviteLinkForOrganization(db: Database, organizationId: string) {
	const [link] = await db
		.select()
		.from(schema.organizationInviteLink)
		.where(
			and(
				eq(schema.organizationInviteLink.organizationId, organizationId),
				isNull(schema.organizationInviteLink.revokedAt)
			)
		)
		.limit(1);
	return link ?? null;
}

export async function findActiveInviteLink(db: Database, token: string) {
	const [link] = await db
		.select()
		.from(schema.organizationInviteLink)
		.where(
			and(
				eq(schema.organizationInviteLink.token, token),
				isNull(schema.organizationInviteLink.revokedAt)
			)
		)
		.limit(1);
	return link ?? null;
}

/** Revokes any live link for the organization, then creates a new one. */
export async function createInviteLink(db: Database, organizationId: string, createdBy: string) {
	const now = new Date();
	const link = {
		id: crypto.randomUUID(),
		organizationId,
		token: newInviteToken(),
		createdBy,
		createdAt: now
	};
	await db.transaction(async (tx) => {
		await tx
			.update(schema.organizationInviteLink)
			.set({ revokedAt: now })
			.where(
				and(
					eq(schema.organizationInviteLink.organizationId, organizationId),
					isNull(schema.organizationInviteLink.revokedAt)
				)
			);
		await tx.insert(schema.organizationInviteLink).values(link);
	});
	return link;
}

export async function revokeInviteLink(db: Database, organizationId: string) {
	await db
		.update(schema.organizationInviteLink)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(schema.organizationInviteLink.organizationId, organizationId),
				isNull(schema.organizationInviteLink.revokedAt)
			)
		);
}

/**
 * Adds the user to the link's organization as a member when they are not already in it.
 * Returns null when the token is unknown or revoked. An existing role is left as it is.
 */
export async function acceptInviteLink(db: Database, userId: string, token: string) {
	const link = await findActiveInviteLink(db, token);
	if (!link) return null;

	const [existing] = await db
		.select({ id: schema.member.id })
		.from(schema.member)
		.where(
			and(eq(schema.member.organizationId, link.organizationId), eq(schema.member.userId, userId))
		)
		.limit(1);
	if (!existing) {
		await db.insert(schema.member).values({
			id: crypto.randomUUID(),
			organizationId: link.organizationId,
			userId,
			role: 'member',
			createdAt: new Date()
		});
	}
	return link;
}
