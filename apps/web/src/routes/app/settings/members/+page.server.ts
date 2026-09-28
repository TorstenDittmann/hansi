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
import {
	assignableMembershipRoles,
	hasMembershipRole,
	membershipRoleChangeError
} from '$lib/server/membership';
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
	const ownerCount = members.filter((member) => hasMembershipRole(member.role, 'owner')).length;
	return {
		canInvite,
		inviteLink:
			canInvite && inviteLink ? { url: inviteLinkUrl(env.APP_URL, inviteLink.token) } : null,
		members: members.map((member) => ({
			id: member.id,
			role: member.role,
			name: member.user.name,
			email: member.user.email,
			image: member.user.image ?? null,
			assignableRoles: assignableMembershipRoles({
				viewerRole: activeMember?.role,
				memberRole: member.role,
				ownerCount
			})
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

/** better-auth enforces permissions (only owners and admins can invite, remove, or change roles). */
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

	updateRole: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const memberId = String(form.get('memberId') ?? '');
		const role = String(form.get('role') ?? '');
		const auth = await getAuth();
		const [{ members }, activeMember] = await Promise.all([
			auth.api.listMembers({
				headers: request.headers,
				query: { organizationId: organization.id }
			}),
			auth.api.getActiveMember({ headers: request.headers })
		]);
		const member = members.find((candidate) => candidate.id === memberId);
		if (!member) return fail(400, { error: 'Member not found' });
		// Keeping the current role is not a change, including for the last owner.
		if (member.role === role) return;
		const ownerCount = members.filter((candidate) =>
			hasMembershipRole(candidate.role, 'owner')
		).length;
		const denied = membershipRoleChangeError({
			viewerRole: activeMember?.role,
			memberRole: member.role,
			ownerCount,
			nextRole: role
		});
		if (denied) return fail(denied.status, { error: denied.error });
		return run(() =>
			auth.api.updateMemberRole({
				headers: request.headers,
				body: { memberId, role, organizationId: organization.id }
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
