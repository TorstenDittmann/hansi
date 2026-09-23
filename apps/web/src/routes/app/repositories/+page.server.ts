import { fail } from '@sveltejs/kit';
import { getGitHubUserToken } from '$lib/server/github-user';
import { getContext, getGitHubCredentials } from '$lib/server/context';
import { listRepositories, setRepositoryEnabled } from '$lib/server/data';
import { listUserInstallationIds, syncInstallation } from '$lib/server/installations';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organization } = await parent();
	return { repositories: await listRepositories(organization.id) };
};

export const actions: Actions = {
	toggle: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const repositoryId = Number(form.get('repositoryId'));
		if (!Number.isInteger(repositoryId)) return fail(400, { message: 'Invalid repository' });
		await setRepositoryEnabled(organization.id, repositoryId, form.get('enabled') === 'true');
	},

	/** Links every installation the signed-in GitHub user can access to this organization. */
	sync: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const credentials = await getGitHubCredentials();
		if (!credentials) return fail(400, { message: 'GitHub App is not configured' });

		const accessToken = await getGitHubUserToken(locals.user!.id, request.headers);
		const { db } = await getContext();
		const ids = await listUserInstallationIds(accessToken);
		for (const id of ids) await syncInstallation(db, credentials, id, organization.id);
		return { synced: ids.length };
	}
};
