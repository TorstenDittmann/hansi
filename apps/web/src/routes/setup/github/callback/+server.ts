import { error, redirect } from '@sveltejs/kit';
import { exchangeManifestCode, saveGitHubAppCredentials } from '@hans/github';
import { getContext, getGitHubCredentials, invalidateGitHubCredentials } from '$lib/server/context';
import type { RequestHandler } from './$types';

/** GitHub redirects here after the app is created from the manifest. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	if (await getGitHubCredentials()) redirect(303, '/setup');

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const expected = cookies.get('hans_setup_state');
	if (!code || !state || !expected || state !== expected) error(400, 'Invalid setup state');

	const { db, env } = await getContext();
	const credentials = await exchangeManifestCode(code);
	await saveGitHubAppCredentials(db, env.HANS_ENCRYPTION_KEY, credentials);
	invalidateGitHubCredentials();
	cookies.delete('hans_setup_state', { path: '/setup' });

	redirect(303, '/setup');
};
