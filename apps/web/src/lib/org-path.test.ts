import { expect, test } from 'bun:test';
import { organizationHome, organizationSlugFromPath } from './org-path';

test('reads the organization slug and ignores reserved sections', () => {
	expect(organizationSlugFromPath('/app/acme/reviews')).toBe('acme');
	expect(organizationSlugFromPath('/app/acme')).toBe('acme');
	expect(organizationSlugFromPath('/app/personal-abc123/settings/models')).toBe('personal-abc123');
	expect(organizationSlugFromPath('/app')).toBeUndefined();
	expect(organizationSlugFromPath('/app/account')).toBeUndefined();
	expect(organizationSlugFromPath('/app/organizations/new')).toBeUndefined();
	expect(organizationSlugFromPath('/login')).toBeUndefined();
});

test('builds the organization overview path', () => {
	expect(organizationHome('acme')).toBe('/app/acme');
	expect(organizationHome('acme corp')).toBe('/app/acme%20corp');
});
