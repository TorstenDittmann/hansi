import { fail } from '@sveltejs/kit';
import { addLearning, deleteLearning, listLearnings, listRepositories } from '$lib/server/data';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organization } = await parent();
	const [learnings, repositories] = await Promise.all([
		listLearnings(organization.id),
		listRepositories(organization.id)
	]);
	return { learnings, repositories: repositories.map((r) => ({ id: r.id, fullName: r.fullName })) };
};

export const actions: Actions = {
	add: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		const repository = String(form.get('repositoryId') ?? '');
		if (!body) return fail(400, { error: 'Write the rule first' });
		if (body.length > 500) return fail(400, { error: 'Keep rules under 500 characters' });
		try {
			await addLearning(organization.id, {
				body,
				repositoryId: repository ? Number(repository) : null,
				author: locals.user?.githubLogin ?? locals.user?.name ?? null
			});
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
	},

	delete: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		await deleteLearning(organization.id, String(form.get('learningId')));
	}
};
