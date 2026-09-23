// GitHub App manifest flow: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
// Lets a self-hoster create a correctly configured GitHub App with one click.
import type { GitHubAppCredentials } from './credentials';

export function buildAppManifest(publicUrl: string, name: string) {
	const base = publicUrl.replace(/\/+$/, '');
	return {
		name,
		url: base,
		hook_attributes: { url: `${base}/api/webhooks/github`, active: true },
		redirect_url: `${base}/setup/github/callback`,
		callback_urls: [`${base}/api/auth/callback/github`],
		setup_url: `${base}/setup/github/installed`,
		setup_on_update: true,
		public: false,
		default_permissions: {
			metadata: 'read',
			contents: 'read',
			pull_requests: 'write',
			issues: 'write',
			checks: 'write',
			email_addresses: 'read'
		},
		default_events: ['pull_request', 'issue_comment', 'pull_request_review_comment']
	};
}

/** Where the manifest form is POSTed: a personal account, or an organization when given. */
export function manifestFormAction(state: string, organization?: string) {
	const path = organization
		? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new`
		: 'https://github.com/settings/apps/new';
	return `${path}?state=${encodeURIComponent(state)}`;
}

/** Exchanges the temporary code GitHub redirects back with for the new app's credentials. */
export async function exchangeManifestCode(
	code: string,
	fetchImpl: typeof fetch = fetch
): Promise<GitHubAppCredentials> {
	const response = await fetchImpl(
		`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
		{
			method: 'POST',
			headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
		}
	);
	if (!response.ok) {
		throw new Error(
			`GitHub manifest conversion failed: ${response.status} ${await response.text()}`
		);
	}
	const app = (await response.json()) as {
		id: number;
		slug: string;
		pem: string;
		webhook_secret: string;
		client_id: string;
		client_secret: string;
	};
	return {
		appId: String(app.id),
		slug: app.slug,
		privateKey: app.pem,
		webhookSecret: app.webhook_secret,
		clientId: app.client_id,
		clientSecret: app.client_secret
	};
}
