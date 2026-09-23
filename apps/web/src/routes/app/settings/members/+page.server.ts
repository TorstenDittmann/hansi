import { fail } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, request }) => {
	const { organization } = await parent();
	const auth = await getAuth();
	const [{ members }, invitations] = await Promise.all([
		auth.api.listMembers({ headers: request.headers, query: { organizationId: organization.id } }),
		auth.api.listInvitations({
			headers: request.headers,
			query: { organizationId: organization.id }
		})
	]);
	return {
		members: members.map((member) => ({
			id: member.id,
			role: member.role,
			name: member.user.name,
			email: member.user.email,
			image: member.user.image ?? null
		})),
		invitations: invitations
			.filter((invitation) => invitation.status === 'pending')
			.map((invitation) => ({
				id: invitation.id,
				email: invitation.email,
				role: invitation.role,
				expiresAt: invitation.expiresAt
			}))
	};
};

/** better-auth enforces permissions (only owners and admins can invite or remove). */
async function run(action: () => Promise<unknown>) {
	try {
		await action();
	} catch (error) {
		return fail(400, { error: (error as Error).message });
	}
}

export const actions: Actions = {
	invite: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const role = form.get('role') === 'admin' ? 'admin' : 'member';
		if (!email.includes('@')) return fail(400, { error: 'Enter an email address' });
		const auth = await getAuth();
		return run(() =>
			auth.api.createInvitation({
				headers: request.headers,
				body: { email, role, organizationId: organization.id }
			})
		);
	},

	cancel: async ({ request }) => {
		const form = await request.formData();
		const auth = await getAuth();
		return run(() =>
			auth.api.cancelInvitation({
				headers: request.headers,
				body: { invitationId: String(form.get('invitationId')) }
			})
		);
	},

	remove: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const auth = await getAuth();
		return run(() =>
			auth.api.removeMember({
				headers: request.headers,
				body: { memberIdOrEmail: String(form.get('memberId')), organizationId: organization.id }
			})
		);
	}
};
