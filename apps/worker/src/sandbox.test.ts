import { expect, test } from 'bun:test';
import { isBlockedAddress } from './egress-proxy';
import { lazySandbox, memoryUsage, readTail, sandboxSpec, type ReviewSandbox } from './sandbox';

test('a lazy sandbox starts on its first command and only then needs closing', async () => {
	let opened = 0;
	let closed = 0;
	const sandbox = lazySandbox(async (): Promise<ReviewSandbox> => {
		opened++;
		return {
			runner: {
				run: async (command) => ({ exitCode: 0, stdout: command, stderr: '', timedOut: false })
			},
			close: async () => {
				closed++;
			}
		};
	});
	expect(opened).toBe(0);
	expect((await sandbox.runner.run('a', { timeoutMs: 1 })).stdout).toBe('a');
	await sandbox.runner.run('b', { timeoutMs: 1 });
	expect(opened).toBe(1);
	await sandbox.close();
	expect(closed).toBe(1);

	const unused = lazySandbox(async () => {
		throw new Error('should not start');
	});
	await unused.close();
});

test('a lazy sandbox that cannot start fails its commands with the reason', async () => {
	const sandbox = lazySandbox(async () => {
		throw new Error('runsc missing');
	});
	await expect(sandbox.runner.run('ls', { timeoutMs: 1 })).rejects.toThrow(
		'The sandbox could not start: runsc missing'
	);
	await sandbox.close();
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
