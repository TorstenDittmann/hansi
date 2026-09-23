import { Hono } from 'hono';
import { getAuth } from '../auth';
import { handleGitHubWebhook } from '../webhooks';

/**
 * Everything under /api: better-auth, GitHub webhooks, and (later) the public, versioned API.
 * Dashboard pages don't go through here; they use SvelteKit load functions and form actions.
 */
export const api = new Hono()
	.basePath('/api')
	.get('/health', (c) => c.json({ ok: true }))
	.on(['GET', 'POST'], '/auth/*', async (c) => (await getAuth()).handler(c.req.raw))
	.post('/webhooks/github', (c) => handleGitHubWebhook(c.req.raw));

export type Api = typeof api;
