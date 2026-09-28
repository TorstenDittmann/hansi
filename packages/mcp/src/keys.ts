import { schema, type ApiKeyScope, type Database } from '@hans/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

const PREFIX = 'hsk_';
const MAX_KEYS = 20;

export interface AuthenticatedKey {
	id: string;
	organizationId: string;
	name: string;
	scopes: ApiKeyScope[];
	lastUsedAt: Date | null;
}

export function generateApiKey() {
	const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
	return {
		secret: `${PREFIX}${raw}`,
		prefix: `${PREFIX}${raw.slice(0, 4)}`,
		hint: raw.slice(-4)
	};
}

export async function hashApiKey(secret: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return Buffer.from(digest).toString('hex');
}

export function bearerToken(header: string | null) {
	if (!header) return null;
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	return match?.[1] ?? null;
}

/** `write` includes `read`: a key that can change things can also look. */
export function hasScope(scopes: readonly ApiKeyScope[], scope: ApiKeyScope) {
	return scopes.includes(scope) || (scope === 'read' && scopes.includes('write'));
}

export async function createApiKey(
	db: Database,
	input: {
		organizationId: string;
		name: string;
		scopes: ApiKeyScope[];
		createdBy?: string | null;
	}
) {
	const name = input.name.trim();
	if (!name || name.length > 60) throw new Error('Name the key in 60 characters or fewer');
	const scopes = [...new Set(input.scopes)];
	if (scopes.length === 0 || scopes.some((scope) => scope !== 'read' && scope !== 'write')) {
		throw new Error('Choose the read scope, the write scope, or both');
	}

	const existing = await db
		.select({ id: schema.apiKeys.id })
		.from(schema.apiKeys)
		.where(
			and(eq(schema.apiKeys.organizationId, input.organizationId), isNull(schema.apiKeys.revokedAt))
		);
	if (existing.length >= MAX_KEYS) throw new Error('This organization already has 20 API keys');

	const { secret, prefix, hint } = generateApiKey();
	const [row] = await db
		.insert(schema.apiKeys)
		.values({
			organizationId: input.organizationId,
			name,
			keyPrefix: prefix,
			keyHint: hint,
			keyHash: await hashApiKey(secret),
			scopes,
			createdBy: input.createdBy ?? null
		})
		.returning({ id: schema.apiKeys.id });
	return { id: row!.id, secret, prefix, hint, name, scopes };
}

export async function listApiKeys(db: Database, organizationId: string) {
	return db
		.select({
			id: schema.apiKeys.id,
			name: schema.apiKeys.name,
			keyPrefix: schema.apiKeys.keyPrefix,
			keyHint: schema.apiKeys.keyHint,
			scopes: schema.apiKeys.scopes,
			lastUsedAt: schema.apiKeys.lastUsedAt,
			createdAt: schema.apiKeys.createdAt
		})
		.from(schema.apiKeys)
		.where(and(eq(schema.apiKeys.organizationId, organizationId), isNull(schema.apiKeys.revokedAt)))
		.orderBy(desc(schema.apiKeys.createdAt));
}

export async function revokeApiKey(db: Database, organizationId: string, keyId: string) {
	const [row] = await db
		.update(schema.apiKeys)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(schema.apiKeys.id, keyId),
				eq(schema.apiKeys.organizationId, organizationId),
				isNull(schema.apiKeys.revokedAt)
			)
		)
		.returning({ id: schema.apiKeys.id });
	return !!row;
}

export async function authenticateApiKey(
	db: Database,
	secret: string
): Promise<AuthenticatedKey | null> {
	if (!secret.startsWith(PREFIX) || secret.length < PREFIX.length + 20) return null;
	const [row] = await db
		.select({
			id: schema.apiKeys.id,
			organizationId: schema.apiKeys.organizationId,
			name: schema.apiKeys.name,
			scopes: schema.apiKeys.scopes,
			lastUsedAt: schema.apiKeys.lastUsedAt,
			revokedAt: schema.apiKeys.revokedAt
		})
		.from(schema.apiKeys)
		.where(eq(schema.apiKeys.keyHash, await hashApiKey(secret)))
		.limit(1);
	if (!row || row.revokedAt) return null;
	return {
		id: row.id,
		organizationId: row.organizationId,
		name: row.name,
		scopes: row.scopes,
		lastUsedAt: row.lastUsedAt
	};
}

/** At most once a minute, so a busy agent does not write on every tool call. */
export async function touchApiKey(db: Database, key: AuthenticatedKey, now = new Date()) {
	if (key.lastUsedAt && now.getTime() - key.lastUsedAt.getTime() < 60_000) return;
	await db.update(schema.apiKeys).set({ lastUsedAt: now }).where(eq(schema.apiKeys.id, key.id));
}
