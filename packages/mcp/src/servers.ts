import { schema, type Database } from '@hans/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { assertSafeMcpUrl, type McpUrlPolicy } from './url';

export const MCP_SERVER_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_MCP_SERVERS = 8;
export const MAX_ALLOWED_TOOLS = 40;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,80}$/;

export interface SaveMcpServerInput {
	organizationId: string;
	id?: string;
	name: string;
	url: string;
	guidance: string;
	enabled: boolean;
	/** Undefined on update keeps the current list. */
	allowedTools?: string[];
	/** Undefined on update keeps the current ciphertext. Null clears it. */
	encryptedToken?: string | null;
}

export async function listMcpServers(db: Database, organizationId: string) {
	const rows = await db
		.select({
			id: schema.mcpServers.id,
			name: schema.mcpServers.name,
			url: schema.mcpServers.url,
			guidance: schema.mcpServers.guidance,
			enabled: schema.mcpServers.enabled,
			allowedTools: schema.mcpServers.allowedTools,
			hasToken: sql<boolean>`${schema.mcpServers.encryptedToken} is not null`.mapWith(Boolean),
			createdAt: schema.mcpServers.createdAt,
			updatedAt: schema.mcpServers.updatedAt
		})
		.from(schema.mcpServers)
		.where(eq(schema.mcpServers.organizationId, organizationId))
		.orderBy(asc(schema.mcpServers.name));
	return rows;
}

export async function getMcpServer(db: Database, organizationId: string, id: string) {
	const [row] = await db
		.select()
		.from(schema.mcpServers)
		.where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.organizationId, organizationId)));
	return row ?? null;
}

export async function saveMcpServer(
	db: Database,
	input: SaveMcpServerInput,
	policy: McpUrlPolicy = {}
) {
	const name = input.name.trim();
	if (!MCP_SERVER_NAME.test(name)) {
		throw new Error('Use a short lowercase name, like "linear"');
	}
	const guidance = input.guidance.trim();
	if (guidance.length > 2000) throw new Error('Keep the usage guidance under 2000 characters');
	const url = (await assertSafeMcpUrl(input.url.trim(), policy)).toString();
	const allowedTools = input.allowedTools ? normalizeTools(input.allowedTools) : undefined;
	const current = input.id ? await getMcpServer(db, input.organizationId, input.id) : null;

	if (!current) {
		const existing = await listMcpServers(db, input.organizationId);
		if (existing.length >= MAX_MCP_SERVERS) {
			throw new Error('This organization already has 8 MCP servers');
		}
		if (existing.some((server) => server.name === name)) {
			throw new Error(`An MCP server named ${name} already exists`);
		}
		const id = input.id ?? crypto.randomUUID();
		await db.insert(schema.mcpServers).values({
			id,
			organizationId: input.organizationId,
			name,
			url,
			guidance,
			enabled: input.enabled,
			allowedTools: allowedTools ?? [],
			encryptedToken: input.encryptedToken ?? null
		});
		return id;
	}

	if (name !== current.name) {
		const [clash] = await db
			.select({ id: schema.mcpServers.id })
			.from(schema.mcpServers)
			.where(
				and(
					eq(schema.mcpServers.organizationId, input.organizationId),
					eq(schema.mcpServers.name, name)
				)
			);
		if (clash) throw new Error(`An MCP server named ${name} already exists`);
	}
	await db
		.update(schema.mcpServers)
		.set({
			name,
			url,
			guidance,
			enabled: input.enabled,
			allowedTools: allowedTools ?? current.allowedTools,
			encryptedToken:
				input.encryptedToken === undefined ? current.encryptedToken : input.encryptedToken
		})
		.where(eq(schema.mcpServers.id, current.id));
	return current.id;
}

export async function deleteMcpServer(db: Database, organizationId: string, id: string) {
	const [row] = await db
		.delete(schema.mcpServers)
		.where(and(eq(schema.mcpServers.id, id), eq(schema.mcpServers.organizationId, organizationId)))
		.returning({ id: schema.mcpServers.id });
	return !!row;
}

function normalizeTools(tools: string[]) {
	const unique = [...new Set(tools.map((tool) => tool.trim()).filter(Boolean))];
	if (unique.length > MAX_ALLOWED_TOOLS) {
		throw new Error(`Allow at most ${MAX_ALLOWED_TOOLS} tools`);
	}
	for (const tool of unique) {
		if (!TOOL_NAME.test(tool)) throw new Error(`Tool name is not allowed: ${tool}`);
	}
	return unique;
}
