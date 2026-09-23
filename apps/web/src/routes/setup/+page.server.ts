import { dev } from '$app/environment';
import { buildAppManifest } from '@hans/github';
import { getContext, getGitHubCredentials } from '$lib/server/context';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const credentials = await getGitHubCredentials();
	if (credentials) return { configured: true as const, slug: credentials.slug };

	const { env } = await getContext();
	const state = crypto.randomUUID();
	cookies.set('hans_setup_state', state, {
		path: '/setup',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: 60 * 60
	});

	const publicUrl = env.APP_URL;
	const suffix = crypto.randomUUID().slice(0, 6);
	return {
		configured: false as const,
		state,
		publicUrl,
		isLocal: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(publicUrl),
		defaultName: `hans-${suffix}`,
		manifest: buildAppManifest(publicUrl, `hans-${suffix}`)
	};
};
