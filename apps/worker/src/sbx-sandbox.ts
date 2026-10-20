import { readFile, rm } from 'node:fs/promises';
import { git } from '@hans/core';
import { SbxClient, SbxError, Template } from '@sbx.torsten.work/sbx';
import {
	MAX_LIFETIME_SECONDS,
	MEMORY_BYTES,
	runSetup,
	runWithTimeout,
	WORKSPACE,
	type OpenSandboxOptions,
	type ReviewSandbox,
	type Spawned
} from './sandbox';

/** The writable /workspace, which holds the checkout and the installed dependencies. */
const DISK_MB = 4096;
const CPUS = 2;

/**
 * The toolchain the gVisor sandbox has (see `sandbox-rootfs` in docker/Dockerfile), built by sbx
 * once and cached. Composer and Go come from their installers, since builds cannot copy files out
 * of other images.
 */
export const TOOLCHAIN = new Template({ image: 'node:22-bookworm-slim' })
	.withPackages(
		...['build-essential', 'ca-certificates', 'curl', 'git', 'unzip'],
		...['python3', 'python3-pip', 'python3-venv'],
		...['php-cli', 'php-curl', 'php-intl', 'php-mbstring', 'php-mysql', 'php-pgsql'],
		...['php-sqlite3', 'php-xml', 'php-zip']
	)
	.run(
		'curl -fsSL https://getcomposer.org/installer | php -- --2 --install-dir=/usr/local/bin --filename=composer'
	)
	.run(
		// The newest Go 1.25, like the golang:1.25 image the Dockerfile copies it from.
		`version=$(curl -fsSL 'https://go.dev/dl/?mode=json' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(r=>r.version.startsWith("go1.25.")).version))') && curl -fsSL "https://go.dev/dl/$version.linux-$(dpkg --print-architecture).tar.gz" | tar -xz -C /usr/local`
	);

const BLOCK = 512;

/**
 * Cuts a tar archive right after its end-of-archive marker, dropping the zero padding that fills
 * the last record. sbx stops reading at the marker and fails the upload if more bytes follow.
 */
export function trimTar(tar: Uint8Array): Uint8Array<ArrayBuffer> {
	let offset = 0;
	while (offset + BLOCK <= tar.length) {
		const header = tar.subarray(offset, offset + BLOCK);
		if (header.every((byte) => byte === 0)) break;
		const size = parseInt(
			new TextDecoder().decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim() || '0',
			8
		);
		offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
	}
	return tar.slice(0, Math.min(tar.length, offset + 2 * BLOCK));
}

/** Exec and file calls on a sandbox sbx no longer has, e.g. one past its lifetime. */
function gone(error: unknown): boolean {
	return error instanceof SbxError && (error.status === 404 || error.status === 409);
}

/**
 * Starts a sandbox for one review on an sbx server (https://sbx.torsten.work) instead of in this
 * container. sbx isolates it (Docker, gVisor, Kata, or Firecracker, as the server is set up),
 * caps its memory, and deletes it after an hour even if this worker never does:
 *
 * - It starts from SBX_TEMPLATE, or from Hansi's toolchain image. The checkout at HEAD, without
 *   `.git`, is uploaded to /workspace.
 * - With `network: public` it gets sbx's `full` network, which blocks private ranges and cloud
 *   metadata unless the sbx server opts out. With `none` it has no network.
 * - It holds no credentials: the API key stays in this process.
 */
export async function openSbxSandbox(options: OpenSandboxOptions): Promise<ReviewSandbox> {
	const { env, config, repoDir, name, emit, log } = options;
	const started = Date.now();
	const client = new SbxClient({ baseUrl: env.SBX_URL, apiKey: env.SBX_API_KEY });

	const info = await client.createSandbox({
		template: env.SBX_TEMPLATE ?? TOOLCHAIN,
		cpu: CPUS,
		memoryMb: MEMORY_BYTES / 1024 ** 2,
		diskMb: DISK_MB,
		ttl: MAX_LIFETIME_SECONDS,
		network: { mode: config.sandbox.network === 'public' ? 'full' : 'none' },
		env: {
			PATH: '/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
			CI: 'true'
		},
		labels: { 'hansi.job': name }
	});
	const id = info.id;

	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		await client.deleteSandbox(id).catch((error: unknown) => {
			if (!gone(error)) log.warn({ err: error, id }, 'sbx sandbox delete failed');
		});
	};

	const exec = async (args: string[], timeoutMs: number): Promise<Spawned> => {
		try {
			const { exitCode, stdout, stderr } = await client.exec(id, args, {
				cwd: WORKSPACE,
				timeout: Math.ceil(timeoutMs / 1000)
			});
			return { exitCode, stdout, stderr };
		} catch (error) {
			// sbx gave up on the command itself: report it like a timeout, the sandbox is still there.
			if (error instanceof SbxError && error.code === 'timeout') {
				return { exitCode: null, stdout: '', stderr: '' };
			}
			if (gone(error)) {
				throw new Error(`The sandbox is gone: ${(error as Error).message}`, { cause: error });
			}
			throw error;
		}
	};
	const run = (command: string, timeoutMs: number) => runWithTimeout(exec, command, timeoutMs);

	try {
		const archive = `${repoDir}.sbx.tar`;
		// A tree, not a commit: sbx rejects the pax header with the commit id that a commit gets.
		await git(['archive', '--format=tar', `--output=${archive}`, 'HEAD^{tree}'], { cwd: repoDir });
		try {
			const tar = trimTar(await readFile(archive));
			await client.uploadArchive(id, WORKSPACE, Bun.gzipSync(tar));
		} finally {
			await rm(archive, { force: true });
		}
		emit({ type: 'sandbox.ready', data: { ms: Date.now() - started, provider: 'sbx', id } });
		await runSetup(config, run, emit);
	} catch (error) {
		await close();
		throw error;
	}

	return { runner: { run: (command, { timeoutMs }) => run(command, timeoutMs) }, close };
}
