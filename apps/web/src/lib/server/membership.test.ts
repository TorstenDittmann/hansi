import { expect, test } from 'bun:test';
import { assignableMembershipRoles, membershipRoleChangeError } from './membership';

test('members cannot change roles', () => {
	expect(
		assignableMembershipRoles({ viewerRole: 'member', memberRole: 'member', ownerCount: 1 })
	).toEqual([]);
	expect(
		assignableMembershipRoles({ viewerRole: null, memberRole: 'admin', ownerCount: 1 })
	).toEqual([]);
	expect(
		membershipRoleChangeError({
			viewerRole: 'member',
			memberRole: 'member',
			ownerCount: 1,
			nextRole: 'admin'
		})
	).toEqual({ status: 403, error: 'Only owners and admins can change roles' });
});

test('admins can switch member and admin, not owner', () => {
	expect(
		assignableMembershipRoles({ viewerRole: 'admin', memberRole: 'member', ownerCount: 1 })
	).toEqual(['admin', 'member']);
	expect(
		assignableMembershipRoles({ viewerRole: 'admin', memberRole: 'owner', ownerCount: 1 })
	).toEqual([]);
	expect(
		assignableMembershipRoles({ viewerRole: 'admin,member', memberRole: 'admin', ownerCount: 2 })
	).toEqual(['admin', 'member']);
	expect(
		membershipRoleChangeError({
			viewerRole: 'admin',
			memberRole: 'member',
			ownerCount: 1,
			nextRole: 'owner'
		})
	).toEqual({ status: 403, error: 'Only owners can change the owner role' });
	expect(
		membershipRoleChangeError({
			viewerRole: 'admin',
			memberRole: 'owner',
			ownerCount: 2,
			nextRole: 'admin'
		})
	).toEqual({ status: 403, error: 'Only owners can change the owner role' });
});

test('owners can assign any role, except demoting the last owner', () => {
	expect(
		assignableMembershipRoles({ viewerRole: 'owner', memberRole: 'member', ownerCount: 1 })
	).toEqual(['owner', 'admin', 'member']);
	expect(
		assignableMembershipRoles({ viewerRole: 'owner,admin', memberRole: 'owner', ownerCount: 2 })
	).toEqual(['owner', 'admin', 'member']);
	expect(
		assignableMembershipRoles({ viewerRole: 'owner', memberRole: 'owner', ownerCount: 1 })
	).toEqual([]);
	expect(
		membershipRoleChangeError({
			viewerRole: 'owner',
			memberRole: 'owner',
			ownerCount: 1,
			nextRole: 'admin'
		})
	).toEqual({ status: 400, error: 'Make someone else an owner first' });
	expect(
		membershipRoleChangeError({
			viewerRole: 'owner',
			memberRole: 'member',
			ownerCount: 1,
			nextRole: 'owner'
		})
	).toBeNull();
});

test('rejects an unknown role', () => {
	expect(
		membershipRoleChangeError({
			viewerRole: 'owner',
			memberRole: 'member',
			ownerCount: 1,
			nextRole: 'billing'
		})
	).toEqual({ status: 400, error: 'Choose a role' });
});
