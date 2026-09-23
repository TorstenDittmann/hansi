import { schema } from '@hans/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { getContext, getGitHubCredentials } from './context';

async function createAuth() {
	const { db, env } = await getContext();
	const github = await getGitHubCredentials();

	return betterAuth({
		baseURL: env.APP_URL,
		basePath: '/api/auth',
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: 'sqlite',
			schema: {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification,
				organization: schema.organization,
				member: schema.member,
				invitation: schema.invitation
			}
		}),
		// Sign-in uses the GitHub App's own OAuth credentials: one app for login and repo access.
		socialProviders: github
			? { github: { clientId: github.clientId, clientSecret: github.clientSecret } }
			: {},
		plugins: [organization()],
		telemetry: { enabled: false }
	});
}

type Auth = Awaited<ReturnType<typeof createAuth>>;
export type Session = Auth['$Infer']['Session']['session'];
export type User = Auth['$Infer']['Session']['user'];

let cached: { key: string; auth: Promise<Auth> } | undefined;

/** better-auth instance, rebuilt when the GitHub App credentials change (e.g. after setup). */
export async function getAuth(): Promise<Auth> {
	const key = (await getGitHubCredentials())?.clientId ?? 'unconfigured';
	if (cached?.key !== key) cached = { key, auth: createAuth() };
	return cached.auth;
}
