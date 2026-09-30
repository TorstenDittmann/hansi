import { expect, test } from 'bun:test';
import { legacyAppDestination, organizationSlugFromPath } from './org-path';

test('reads the organization slug and ignores reserved sections', () => {
	expect(organizationSlugFromPath('/app/acme/reviews')).toBe('acme');
	expect(organizationSlugFromPath('/app/acme')).toBe('acme');
	expect(organizationSlugFromPath('/app/personal-abc123/settings/models')).toBe('personal-abc123');
	expect(organizationSlugFromPath('/app')).toBeUndefined();
	expect(organizationSlugFromPath('/app/account')).toBeUndefined();
	expect(organizationSlugFromPath('/app/organizations/new')).toBeUndefined();
	expect(organizationSlugFromPath('/app/reviews/1')).toBeUndefined();
	expect(organizationSlugFromPath('/app/settings/members')).toBeUndefined();
	expect(organizationSlugFromPath('/login')).toBeUndefined();
});

test('sends old app URLs to the same page under the organization', () => {
	expect(legacyAppDestination('/app', '', 'acme')).toBe('/app/acme');
	expect(legacyAppDestination('/app/', '?x=1', 'acme')).toBe('/app/acme?x=1');
	expect(legacyAppDestination('/app/reviews', '?q=api', 'acme')).toBe('/app/acme/reviews?q=api');
	expect(legacyAppDestination('/app/reviews/rev-1', '', 'acme')).toBe('/app/acme/reviews/rev-1');
	expect(legacyAppDestination('/app/settings/models', '', 'acme corp')).toBe(
		'/app/acme%20corp/settings/models'
	);
	expect(legacyAppDestination('/app/repositories', '?elsewhere=1', 'acme')).toBe(
		'/app/acme/repositories?elsewhere=1'
	);
	expect(legacyAppDestination('/app/acme/reviews', '', 'other')).toBeNull();
	expect(legacyAppDestination('/app/account', '', 'acme')).toBeNull();
	expect(legacyAppDestination('/app/organizations/new', '', 'acme')).toBeNull();
});
