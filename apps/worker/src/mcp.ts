import type { EmitEvent } from '@hans/core';
import { schema } from '@hans/db';
import { decryptSecret } from '@hans/llm';
import { connectReviewMcpTools, type ReviewMcpServer } from '@hans/mcp';
import { and, eq } from 'drizzle-orm';
import type { WorkerContext } from './shared';

/** MCP tools for this organization's connected servers. A server that fails to connect is skipped. */
export async function loadReviewMcp(
	ctx: WorkerContext,
	organizationId: string,
	onEvent: EmitEvent
) {
	const rows = await ctx.db
		.select()
		.from(schema.mcpServers)
		.where(
			and(eq(schema.mcpServers.organizationId, organizationId), eq(schema.mcpServers.enabled, true))
		);

	const servers: ReviewMcpServer[] = [];
	for (const row of rows) {
		if (row.allowedTools.length === 0) continue;
		let token: string | undefined;
		if (row.encryptedToken) {
			try {
				token = await decryptSecret(
					row.encryptedToken,
					ctx.env.HANS_ENCRYPTION_KEY,
					`mcp_servers:${row.id}`
				);
			} catch {
				onEvent({
					type: 'mcp.unavailable',
					data: { server: row.name, error: 'Could not read the stored token' }
				});
				continue;
			}
		}
		servers.push({
			name: row.name,
			url: row.url,
			token,
			guidance: row.guidance,
			allowedTools: row.allowedTools
		});
	}
	if (servers.length === 0) return { tools: {}, context: [] };

	return connectReviewMcpTools(servers, {
		allowPrivate: ctx.env.MCP_ALLOW_PRIVATE_URLS,
		allowInsecureLocalhost: ctx.env.NODE_ENV !== 'production' || ctx.env.MCP_ALLOW_PRIVATE_URLS,
		onEvent
	});
}
