import { expect, test } from 'bun:test';
import { isBlockedAddress } from './egress-proxy';
import { memoryUsage, readTail, sandboxSkipReason, sandboxSpec } from './sandbox';

test('every review gets a sandbox unless the instance turns it off', () => {
	expect(sandboxSkipReason({ SANDBOX: 'on' })).toBeNull();
	expect(sandboxSkipReason({ SANDBOX: 'off' })).toBe('SANDBOX=off on this instance');
});

test('the egress proxy refuses private, loopback, link-local, and metadata addresses', () => {
	for (const ip of [
		'10.1.2.3',
		'172.17.0.1',
		'192.168.1.1',
		'127.0.0.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'::1',
		'fd00::1',
		'fe80::1',
		'::ffff:10.0.0.1',
		'64:ff9b::a9fe:a9fe'
	]) {
		expect({ ip, blocked: isBlockedAddress(ip) }).toEqual({ ip, blocked: true });
	}
	for (const ip of ['104.16.0.1', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
		expect({ ip, blocked: isBlockedAddress(ip) }).toEqual({ ip, blocked: false });
	}
});

test('the sandbox gets the checkout, the proxy, and no network of its own', () => {
	const spec = sandboxSpec({ rootfs: '/rootfs', workspace: '/w', proxyDir: '/p' });
	expect(spec.process.cwd).toBe('/workspace');
	expect(spec.process.env).toContain('HTTPS_PROXY=http://127.0.0.1:3128');
	expect(spec.process.env.some((entry) => entry.includes('SECRET') || entry.includes('KEY'))).toBe(
		false
	);
	expect(spec.mounts).toContainEqual({
		destination: '/workspace',
		type: 'bind',
		source: '/w',
		options: ['rbind', 'rw']
	});
	expect(spec.linux.namespaces).toContainEqual({ type: 'network' });
});

test('memoryUsage reads runsc stats and tolerates junk', () => {
	const stats = JSON.stringify({ type: 'stats', data: { memory: { usage: { usage: 1234 } } } });
	expect(memoryUsage(stats)).toBe(1234);
	expect(memoryUsage('not json')).toBeNull();
	expect(memoryUsage('{}')).toBeNull();
});

test('readTail keeps only the end of long output', async () => {
	const stream = new Blob(['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)]).stream();
	expect(await readTail(stream, 60)).toBe('b'.repeat(10) + 'c'.repeat(50));
	expect(await readTail(new Blob(['short']).stream(), 60)).toBe('short');
});
