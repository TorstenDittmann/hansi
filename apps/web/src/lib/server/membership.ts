/** Organization membership roles, matching better-auth's default owner, admin, and member. */
export const membershipRoles = ['owner', 'admin', 'member'] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export function membershipRoleList(role: string | null | undefined) {
	return (role ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

export function hasMembershipRole(role: string | null | undefined, expected: MembershipRole) {
	return membershipRoleList(role).includes(expected);
}

export function isMembershipRole(role: string): role is MembershipRole {
	return (membershipRoles as readonly string[]).includes(role);
}

/**
 * Roles the viewer may assign to this member.
 * Owners may assign any role, except demoting the last owner.
 * Admins may assign admin or member, and cannot change an owner.
 */
export function assignableMembershipRoles(input: {
	viewerRole: string | null | undefined;
	memberRole: string | null | undefined;
	ownerCount: number;
}): MembershipRole[] {
	const viewerIsOwner = hasMembershipRole(input.viewerRole, 'owner');
	const viewerCanManage = viewerIsOwner || hasMembershipRole(input.viewerRole, 'admin');
	if (!viewerCanManage) return [];

	const memberIsOwner = hasMembershipRole(input.memberRole, 'owner');
	if (memberIsOwner && !viewerIsOwner) return [];
	if (memberIsOwner && input.ownerCount <= 1) return [];

	return viewerIsOwner ? ['owner', 'admin', 'member'] : ['admin', 'member'];
}

/** Why a role change is refused, or null when it is allowed. */
export function membershipRoleChangeError(input: {
	viewerRole: string | null | undefined;
	memberRole: string | null | undefined;
	ownerCount: number;
	nextRole: string;
}): { status: 400 | 403; error: string } | null {
	if (!isMembershipRole(input.nextRole)) return { status: 400, error: 'Choose a role' };
	if (assignableMembershipRoles(input).includes(input.nextRole)) return null;

	const viewerIsOwner = hasMembershipRole(input.viewerRole, 'owner');
	const viewerCanManage = viewerIsOwner || hasMembershipRole(input.viewerRole, 'admin');
	if (!viewerCanManage) return { status: 403, error: 'Only owners and admins can change roles' };
	if (hasMembershipRole(input.memberRole, 'owner') && input.ownerCount <= 1 && viewerIsOwner) {
		return { status: 400, error: 'Make someone else an owner first' };
	}
	if (input.nextRole === 'owner' || hasMembershipRole(input.memberRole, 'owner')) {
		return { status: 403, error: 'Only owners can change the owner role' };
	}
	return { status: 403, error: 'You cannot change this role' };
}
