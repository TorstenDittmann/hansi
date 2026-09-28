import { fail } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { getContext } from '$lib/server/context';
import {
	canManageInviteLinks,
	createInviteLink,
	findActiveInviteLinkForOrganization,
	inviteLinkUrl,
	revokeInviteLink
} from '$lib/server/invite-link';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, request }) => {
	const { organization } = await parent();
	const auth = await getAuth();
	const { db, env } = await getContext();
	const [{ members }, invitations, activeMember, inviteLink] = await Promise.all([
		auth.api.listMembers({ headers: request.headers, query: { organizationId: organization.id } }),
		auth.api.listInvitations({
			headers: request.headers,
			query: { organizationId: organization.id }
		}),
		auth.api.getActiveMember({ headers: request.headers }),
		findActiveInviteLinkForOrganization(db, organization.id)
	]);
	const canInvite = canManageInviteLinks(activeMember?.role);
	return {
		canInvite,
		inviteLink:
			canInvite && inviteLink ? { url: inviteLinkUrl(env.APP_URL, inviteLink.token) } : null,
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
	},

	createLink: async ({ locals, request }) => {
		const access = await requireInviteManager(locals, request.headers);
		if (!access) return fail(403, { error: 'Only owners and admins can manage invite links' });
		const { db } = await getContext();
		await createInviteLink(db, access.organizationId, access.userId);
	},

	revokeLink: async ({ locals, request }) => {
		const access = await requireInviteManager(locals, request.headers);
		if (!access) return fail(403, { error: 'Only owners and admins can manage invite links' });
		const { db } = await getContext();
		await revokeInviteLink(db, access.organizationId);
	}
};

async function requireInviteManager(locals: App.Locals, headers: Headers) {
	const organization = await requireOrganization(locals, headers);
	const auth = await getAuth();
	const member = await auth.api.getActiveMember({ headers });
	if (!locals.user || !canManageInviteLinks(member?.role)) return null;
	return { organizationId: organization.id, userId: locals.user.id };
}
