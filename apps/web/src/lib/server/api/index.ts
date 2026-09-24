import { Hono } from 'hono';
import { getAuth } from '../auth';
import { getContext } from '../context';
import { handleGitHubWebhook } from '../webhooks';

/**
 * Everything under /api: better-auth, GitHub webhooks, and (later) the public, versioned API.
 * Dashboard pages don't go through here; they use SvelteKit load functions and form actions.
 */
export const api = new Hono()
	.basePath('/api')
	.get('/health', (c) => c.json({ ok: true }))
	.get('/debug/status', async (c) => {
		const { env } = await getContext();
		return c.json({
			ok: true,
			appUrl: env.APP_URL,
			authSecret: env.BETTER_AUTH_SECRET,
			encryptionKey: env.HANS_ENCRYPTION_KEY,
			signupMode: env.SIGNUP_MODE,
			githubClientSecret: env.GITHUB_CLIENT_SECRET
		});
	})
	.on(['GET', 'POST'], '/auth/*', async (c) => (await getAuth()).handler(c.req.raw))
	.post('/webhooks/github', (c) => handleGitHubWebhook(c.req.raw));

export type Api = typeof api;
