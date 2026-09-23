import { error } from '@sveltejs/kit';
import { getAuth } from './auth';

/**
 * The signed-in user's active organization. New users get a personal workspace on first visit,
 * so there is always somewhere to attach GitHub installations and provider keys.
 */
export async function requireOrganization(locals: App.Locals, headers: Headers) {
	if (!locals.user || !locals.session) error(401, 'Not signed in');
	const auth = await getAuth();

	let organizations = await auth.api.listOrganizations({ headers });
	if (organizations.length === 0) {
		await auth.api.createOrganization({
			headers,
			body: {
				name: `${locals.user.name || locals.user.email}'s workspace`,
				slug: `ws-${locals.user.id.slice(0, 12).toLowerCase()}`
			}
		});
		organizations = await auth.api.listOrganizations({ headers });
	}

	const active =
		organizations.find((org) => org.id === locals.session?.activeOrganizationId) ??
		organizations[0];
	if (!active) error(500, 'Could not create a workspace');

	if (active.id !== locals.session.activeOrganizationId) {
		await auth.api.setActiveOrganization({ headers, body: { organizationId: active.id } });
	}
	return active;
}
