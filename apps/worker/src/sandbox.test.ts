import { expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import { sandboxSkipReason } from './sandbox';

const enabled = parseRepoConfig(JSON.stringify({ sandbox: { enabled: true } })).config;

test('sandbox needs both the repository and the instance to opt in', () => {
	expect(
		sandboxSkipReason({ SANDBOX: 'local', MSB_API_KEY: undefined }, parseRepoConfig('').config)
	).toBe('disabled in .hansi.json');
	expect(sandboxSkipReason({ SANDBOX: 'off', MSB_API_KEY: undefined }, enabled)).toBe(
		'no sandbox backend on this instance'
	);
	expect(sandboxSkipReason({ SANDBOX: 'local', MSB_API_KEY: undefined }, enabled)).toBeNull();
});

test('the cloud backend needs an API key', () => {
	expect(sandboxSkipReason({ SANDBOX: 'cloud', MSB_API_KEY: undefined }, enabled)).toBe(
		'SANDBOX=cloud without MSB_API_KEY'
	);
	expect(sandboxSkipReason({ SANDBOX: 'cloud', MSB_API_KEY: 'msb_x' }, enabled)).toBeNull();
});
