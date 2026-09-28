import { handleMcpRequest } from '@hans/mcp';
import { Hono } from 'hono';
import { getAuth } from '../auth';
import { getContext } from '../context';
import { handleGitHubWebhook } from '../webhooks';

/**
 * Everything under /api: better-auth, GitHub webhooks, and the MCP server.
 * Dashboard pages don't go through here; they use SvelteKit load functions and form actions.
 */
export const api = new Hono()
	.basePath('/api')
	.get('/health', (c) => c.json({ ok: true }))
	.on(['GET', 'POST'], '/auth/*', async (c) => (await getAuth()).handler(c.req.raw))
	.post('/webhooks/github', (c) => handleGitHubWebhook(c.req.raw))
	.all('/mcp', async (c) => {
		const { db, queue } = await getContext();
		return handleMcpRequest(c.req.raw, { db, queue });
	});

export type Api = typeof api;
