import { expect, test } from 'bun:test';
import { buildAppManifest } from './manifest';

test('hans gets read-only access to code by default', () => {
	const manifest = buildAppManifest('https://hans.example/', 'hans-test');
	expect(manifest.default_permissions.contents).toBe('read');
	expect(manifest.hook_attributes.url).toBe('https://hans.example/api/webhooks/github');
});

test('counting approvals requires write access to code', () => {
	const manifest = buildAppManifest('https://hans.example', 'hans-test', { countApprovals: true });
	expect(manifest.default_permissions.contents).toBe('write');
});
