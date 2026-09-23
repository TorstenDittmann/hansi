import { fail } from '@sveltejs/kit';
import { getGitHubUserToken } from '$lib/server/github-user';
import { getContext, getGitHubCredentials } from '$lib/server/context';
import {
	disconnectInstallation,
	listInstallations,
	listRepositories,
	setRepositoryEnabled
} from '$lib/server/data';
import { listUserInstallationIds, syncInstallation } from '$lib/server/installations';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organization } = await parent();
	const [installations, repositories] = await Promise.all([
		listInstallations(organization.id),
		listRepositories(organization.id)
	]);
	return { installations, repositories };
};

export const actions: Actions = {
	toggle: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const repositoryId = Number(form.get('repositoryId'));
		if (!Number.isInteger(repositoryId)) return fail(400, { message: 'Invalid repository' });
		await setRepositoryEnabled(organization.id, repositoryId, form.get('enabled') === 'true');
	},

	/**
	 * Links the installations the signed-in GitHub user can access to this organization, except
	 * ones another organization already owns.
	 */
	sync: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const credentials = await getGitHubCredentials();
		if (!credentials) return fail(400, { message: 'GitHub App is not configured' });

		const accessToken = await getGitHubUserToken(locals.user!.id, request.headers);
		const { db } = await getContext();
		const ids = await listUserInstallationIds(accessToken);
		let linked = 0;
		for (const id of ids)
			if (await syncInstallation(db, credentials, id, organization.id)) linked++;
		return { synced: linked, elsewhere: ids.length - linked };
	},

	disconnect: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const installationId = Number(form.get('installationId'));
		if (!Number.isInteger(installationId)) return fail(400, { message: 'Invalid installation' });
		await disconnectInstallation(organization.id, installationId);
	}
};
