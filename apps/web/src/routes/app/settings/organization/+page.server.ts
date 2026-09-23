import { fail, redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, request }) => {
	const { organization } = await parent();
	const auth = await getAuth();
	const member = await auth.api.getActiveMember({ headers: request.headers });
	return { role: member?.role ?? 'member', memberCount: await countMembers(organization.id) };

	async function countMembers(organizationId: string) {
		const { members } = await auth.api.listMembers({
			headers: request.headers,
			query: { organizationId }
		});
		return members.length;
	}
};

async function run(action: () => Promise<unknown>) {
	try {
		await action();
	} catch (error) {
		return fail(400, { error: (error as Error).message });
	}
}

export const actions: Actions = {
	rename: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'The name cannot be empty' });
		if (name.length > 60) return fail(400, { error: 'Keep the name under 60 characters' });
		const auth = await getAuth();
		return (
			(await run(() =>
				auth.api.updateOrganization({
					headers: request.headers,
					body: { organizationId: organization.id, data: { name } }
				})
			)) ?? { renamed: true }
		);
	},

	leave: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const auth = await getAuth();
		const failed = await run(() =>
			auth.api.leaveOrganization({
				headers: request.headers,
				body: { organizationId: organization.id }
			})
		);
		if (failed) return failed;
		redirect(303, '/app');
	},

	delete: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const confirmation = String((await request.formData()).get('confirm') ?? '').trim();
		if (confirmation !== organization.name) {
			return fail(400, { error: `Type "${organization.name}" to confirm` });
		}
		const auth = await getAuth();
		const failed = await run(() =>
			auth.api.deleteOrganization({
				headers: request.headers,
				body: { organizationId: organization.id }
			})
		);
		if (failed) return failed;
		redirect(303, '/app');
	}
};
