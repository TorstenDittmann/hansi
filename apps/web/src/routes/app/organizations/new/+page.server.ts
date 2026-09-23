import { fail, redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { organizationSlug } from '$lib/server/organization';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Give the organization a name', name });
		if (name.length > 60) return fail(400, { error: 'Keep the name under 60 characters', name });

		const auth = await getAuth();
		const created = await auth.api.createOrganization({
			headers: request.headers,
			body: { name, slug: organizationSlug(name) }
		});
		if (!created) return fail(500, { error: 'Could not create the organization', name });
		await auth.api.setActiveOrganization({
			headers: request.headers,
			body: { organizationId: created.id }
		});
		redirect(303, '/app');
	}
};
