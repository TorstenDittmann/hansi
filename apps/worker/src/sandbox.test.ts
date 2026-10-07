import { expect, test } from 'bun:test';
import { sandboxSkipReason } from './sandbox';

test('reviews get a VM unless the instance turns it off', () => {
	expect(sandboxSkipReason({ SANDBOX: 'local', MSB_API_KEY: undefined })).toBeNull();
	expect(sandboxSkipReason({ SANDBOX: 'off', MSB_API_KEY: undefined })).toBe(
		'SANDBOX=off on this instance'
	);
});

test('the cloud backend needs an API key', () => {
	expect(sandboxSkipReason({ SANDBOX: 'cloud', MSB_API_KEY: undefined })).toBe(
		'SANDBOX=cloud without MSB_API_KEY'
	);
	expect(sandboxSkipReason({ SANDBOX: 'cloud', MSB_API_KEY: 'msb_x' })).toBeNull();
});
