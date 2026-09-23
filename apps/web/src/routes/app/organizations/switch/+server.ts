import { error, redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/** Makes another of the user's organizations active; better-auth checks membership. */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not signed in');
	const form = await request.formData();
	const organizationId = String(form.get('organizationId') ?? '');
	if (organizationId === 'new') redirect(303, '/app/organizations/new');

	const auth = await getAuth();
	try {
		await auth.api.setActiveOrganization({ headers: request.headers, body: { organizationId } });
	} catch {
		error(403, 'You are not a member of that organization');
	}
	redirect(303, '/app');
};
