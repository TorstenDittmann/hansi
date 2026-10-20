import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '@hans/config';
import { git } from '@hans/core';
import { lazySandbox, trimTar, type ReviewSandbox } from './sandbox';

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
		throw new Error('sbx unreachable');
	});
	await expect(sandbox.runner.run('ls', { timeoutMs: 1 })).rejects.toThrow(
		'The sandbox could not start: sbx unreachable'
	);
	await sandbox.close();
});

test('trimTar ends a git archive right after its end-of-archive marker', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'hansi-trim-'));
	try {
		await git(['init', '-q'], { cwd: dir });
		// The last file ends in zeros, which must not be mistaken for the marker.
		await writeFile(join(dir, 'a.txt'), 'hello');
		await writeFile(join(dir, 'zeros.bin'), new Uint8Array(1500));
		await git(['add', '.'], { cwd: dir });
		const tree = (await git(['write-tree'], { cwd: dir })).trim();
		const archive = join(dir, 'out.tar');
		await git(['archive', '--format=tar', `--output=${archive}`, tree], { cwd: dir });
		const tar = new Uint8Array(await Bun.file(archive).arrayBuffer());

		const trimmed = trimTar(tar);
		// Two entries of one header each, 1 and 3 blocks of data, then the two-block marker.
		expect(trimmed.length).toBe(512 * (1 + 1 + 1 + 3 + 2));
		expect(tar.length).toBeGreaterThan(trimmed.length);
		expect(trimmed.subarray(-1024).every((byte) => byte === 0)).toBe(true);

		await writeFile(archive, trimmed);
		const listed = Bun.spawnSync(['tar', '-tf', archive]);
		expect(listed.stdout.toString().split('\n').filter(Boolean)).toEqual(['a.txt', 'zeros.bin']);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('trimTar leaves an archive without padding as it is', () => {
	const empty = new Uint8Array(1024);
	expect(trimTar(empty).length).toBe(1024);
});

test('an sbx server needs an API key', () => {
	const base = {
		HANS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
		BETTER_AUTH_SECRET: 'x'.repeat(32)
	};
	expect(parseEnv(base).SBX_URL).toBeUndefined();
	expect(() => parseEnv({ ...base, SBX_URL: 'https://sbx.example' })).toThrow(
		/SBX_API_KEY: required with SBX_URL/
	);
	const env = parseEnv({ ...base, SBX_URL: 'https://sbx.example', SBX_API_KEY: 'sbx_k' });
	expect(env.SBX_TEMPLATE).toBeUndefined();
});
