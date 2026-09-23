import { error, redirect } from '@sveltejs/kit';
import { getGitHubUserToken } from '$lib/server/github-user';
import { getContext, getGitHubCredentials } from '$lib/server/context';
import { listUserInstallationIds, syncInstallation } from '$lib/server/installations';
import { requireOrganization } from '$lib/server/organization';
import type { RequestHandler } from './$types';

/** GitHub's setup URL: users land here after installing the app on an account. */
export const GET: RequestHandler = async ({ url, locals, request }) => {
	if (!locals.user)
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);

	const installationId = Number(url.searchParams.get('installation_id'));
	if (!Number.isInteger(installationId) || installationId <= 0) redirect(303, '/app/repositories');

	const credentials = await getGitHubCredentials();
	if (!credentials) redirect(303, '/setup');

	// Only link installations this GitHub user can actually access.
	const accessToken = await getGitHubUserToken(locals.user!.id, request.headers);
	const accessible = await listUserInstallationIds(accessToken);
	if (!accessible.includes(installationId))
		error(403, 'You do not have access to this installation');

	const organization = await requireOrganization(locals, request.headers);
	const { db } = await getContext();
	const linked = await syncInstallation(db, credentials, installationId, organization.id);
	redirect(303, linked ? '/app/repositories' : '/app/repositories?elsewhere=1');
};
