import { verify } from '@octokit/webhooks-methods';
import { App, type Octokit } from 'octokit';
import type { GitHubAppCredentials } from './credentials';

export type { Octokit };

const apps = new Map<string, App>();

/** `octokit`'s App bundles the retry and throttling plugins GitHub's rate limits require. */
export function getGitHubApp(credentials: GitHubAppCredentials): App {
	const cacheKey = `${credentials.appId}:${credentials.clientId}`;
	let app = apps.get(cacheKey);
	if (!app) {
		app = new App({
			appId: credentials.appId,
			privateKey: credentials.privateKey,
			webhooks: { secret: credentials.webhookSecret },
			oauth: { clientId: credentials.clientId, clientSecret: credentials.clientSecret }
		});
		apps.set(cacheKey, app);
	}
	return app;
}

export async function getInstallationOctokit(
	credentials: GitHubAppCredentials,
	installationId: number
): Promise<Octokit> {
	return getGitHubApp(credentials).getInstallationOctokit(installationId);
}

/** Short-lived token for `git clone https://x-access-token:<token>@github.com/…`. */
export async function getInstallationToken(octokit: Octokit): Promise<string> {
	const { token } = (await octokit.auth({ type: 'installation' })) as { token: string };
	return token;
}

export function verifyWebhookSignature(
	credentials: GitHubAppCredentials,
	rawBody: string,
	signature: string | null | undefined
): Promise<boolean> {
	if (!signature) return Promise.resolve(false);
	return verify(credentials.webhookSecret, rawBody, signature);
}

/** The handle users mention to talk to the bot, e.g. `@hansi-codes`. */
export function botMention(credentials: GitHubAppCredentials) {
	return `@${credentials.slug}`;
}
