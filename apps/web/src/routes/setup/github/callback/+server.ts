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
	// GitHub has already created the app by now; without its credentials it is unusable.
	const orphaned =
		'GitHub created the app, but Hansi could not save its credentials. Delete it under GitHub → Settings → Developer settings → GitHub Apps, then start again at /setup.';
	if (!code || !state || !expected || state !== expected) {
		error(400, `Setup link expired or was opened in another browser. ${orphaned}`);
	}

	const { db, env } = await getContext();
	const credentials = await exchangeManifestCode(code);
	try {
		await saveGitHubAppCredentials(db, env.HANS_ENCRYPTION_KEY, credentials);
	} catch (cause) {
		console.error('Saving GitHub App credentials failed', cause);
		error(500, orphaned.replace('the app', `the app "${credentials.slug}"`));
	}
	invalidateGitHubCredentials();
	cookies.delete('hans_setup_state', { path: '/setup' });

	redirect(303, '/setup');
};
