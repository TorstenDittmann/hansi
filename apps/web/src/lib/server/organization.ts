import { error } from '@sveltejs/kit';
import { getAuth } from './auth';

/** A URL-friendly slug from a name, with a random suffix so names don't need to be unique. */
export function organizationSlug(name: string) {
	const base = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32);
	return `${base || 'org'}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * The signed-in user's active organization, and all organizations they belong to. New users get
 * a "Personal" organization on first visit, so there is always somewhere to attach GitHub
 * installations and provider keys.
 */
export async function requireOrganization(locals: App.Locals, headers: Headers) {
	const { active } = await organizationsFor(locals, headers);
	return active;
}

export async function organizationsFor(locals: App.Locals, headers: Headers) {
	if (!locals.user || !locals.session) error(401, 'Not signed in');
	const auth = await getAuth();

	// Join organizations this user was invited to before falling back to a personal one.
	// better-auth only matches invitations to verified emails (GitHub reports verification).
	if (locals.user.emailVerified) {
		const invitations = await auth.api.listUserInvitations({ headers });
		for (const invitation of invitations) {
			if (invitation.status === 'pending' && new Date(invitation.expiresAt) > new Date()) {
				await auth.api.acceptInvitation({ headers, body: { invitationId: invitation.id } });
			}
		}
	}

	let organizations = await auth.api.listOrganizations({ headers });
	if (organizations.length === 0) {
		await auth.api.createOrganization({
			headers,
			body: { name: 'Personal', slug: organizationSlug('personal') }
		});
		organizations = await auth.api.listOrganizations({ headers });
	}

	const active =
		organizations.find((org) => org.id === locals.session?.activeOrganizationId) ??
		organizations[0];
	if (!active) error(500, 'Could not create an organization');

	if (active.id !== locals.session.activeOrganizationId) {
		await auth.api.setActiveOrganization({ headers, body: { organizationId: active.id } });
	}
	return { active, organizations };
}
