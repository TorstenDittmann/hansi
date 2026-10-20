import { readFile, rm } from 'node:fs/promises';
import type { Env, RepoConfig } from '@hans/config';
import { git, type CommandResult, type CommandRunner, type EmitEvent } from '@hans/core';
import { schema, type Database } from '@hans/db';
import { SbxClient, SbxError, Template } from '@sbx.torsten.work/sbx';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

/** Where the pull request's files are in the sandbox, and where commands run. */
const WORKSPACE = '/workspace';
const SETUP_TIMEOUT_MS = 10 * 60_000;
/** sbx deletes the sandbox after this long even if the review is still running. */
const MAX_LIFETIME_SECONDS = 60 * 60;
const CPUS = 2;
const MEMORY_MB = 2048;
/** The writable /workspace, which holds the checkout and the installed dependencies. */
const DISK_MB = 4096;
/** `timeout -s KILL` exits with 128 + SIGKILL. */
const KILLED_BY_TIMEOUT = 137;

export interface ReviewSandbox {
	runner: CommandRunner;
	close(): Promise<void>;
}

interface Spawned {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface OpenSandboxOptions {
	env: Env;
	config: RepoConfig;
	repoDir: string;
	name: string;
	emit: EmitEvent;
	log: Logger;
}

/**
 * Runs `command` under `timeout -s KILL` in the sandbox, through `exec`, which returns null as
 * the exit code when it had to give up itself. The in-sandbox timeout fires first, so whatever
 * the command printed before it was killed is kept.
 */
async function runWithTimeout(
	exec: (args: string[], timeoutMs: number) => Promise<Spawned>,
	command: string,
	timeoutMs: number
): Promise<CommandResult> {
	const began = Date.now();
	const seconds = String(Math.ceil(timeoutMs / 1000));
	// The outer timeout only guards a stuck server.
	const result = await exec(
		['timeout', '-s', 'KILL', seconds, 'sh', '-c', command],
		timeoutMs + 30_000
	);
	const timedOut =
		(result.exitCode === KILLED_BY_TIMEOUT || result.exitCode === null) &&
		Date.now() - began >= timeoutMs;
	return { ...result, exitCode: timedOut ? null : result.exitCode, timedOut };
}

/** Runs the repository's setup command, if it has one. A failed setup still leaves a usable sandbox. */
async function runSetup(
	config: RepoConfig,
	run: (command: string, timeoutMs: number) => Promise<CommandResult>,
	emit: EmitEvent
): Promise<void> {
	if (!config.sandbox.setup.trim()) return;
	const setup = await run(config.sandbox.setup, SETUP_TIMEOUT_MS);
	// The model sees the failure itself.
	emit({
		type: 'sandbox.setup',
		data: { command: config.sandbox.setup, exitCode: setup.exitCode, timedOut: setup.timedOut }
	});
}

/**
 * Whether an organization's reviews and replies get a sandbox: when this instance has an sbx
 * server, unless the organization's settings turn it off.
 */
export async function sandboxEnabled(
	env: Env,
	db: Database,
	organizationId: string
): Promise<boolean> {
	if (!env.SBX_URL) return false;
	const [row] = await db
		.select({ sandbox: schema.organizationSettings.sandbox })
		.from(schema.organizationSettings)
		.where(eq(schema.organizationSettings.organizationId, organizationId));
	return row?.sandbox ?? true;
}

/**
 * A sandbox that starts on its first command, for replies that usually need none. If it cannot
 * start, that command and every later one fail with the reason.
 */
export function lazySandbox(open: () => Promise<ReviewSandbox>): ReviewSandbox {
	let opening: Promise<ReviewSandbox> | undefined;
	return {
		runner: {
			run: async (command, options) => {
				opening ??= open();
				const sandbox = await opening.catch((error: unknown) => {
					throw new Error(`The sandbox could not start: ${(error as Error).message}`);
				});
				return sandbox.runner.run(command, options);
			}
		},
		close: async () => {
			const sandbox = await opening?.catch(() => undefined);
			await sandbox?.close();
		}
	};
}

/**
 * What commands run in unless SBX_TEMPLATE names another template: a toolchain most repositories
 * can build and test with, built by sbx once and cached. Anything else can be installed over the
 * network. Composer and Go come from their installers, since builds cannot copy files out of
 * other images.
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
		// The newest Go 1.25.
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
 * Starts a sandbox for one review on the sbx server (https://sbx.torsten.work), so the pull
 * request's code never runs in this container. Every pull request gets one, including those from
 * people without write access. sbx isolates it (Docker, gVisor, Kata, or Firecracker, as the server is set up),
 * caps its memory, and deletes it after an hour even if this worker never does:
 *
 * - It starts from SBX_TEMPLATE, or from Hansi's toolchain image. The checkout at HEAD, without
 *   `.git`, is uploaded to /workspace.
 * - With `network: public` it gets sbx's `full` network, which blocks private ranges and cloud
 *   metadata unless the sbx server opts out. With `none` it has no network.
 * - It holds no credentials: the API key stays in this process.
 */
export async function openSandbox(options: OpenSandboxOptions): Promise<ReviewSandbox> {
	const { env, config, repoDir, name, emit, log } = options;
	const started = Date.now();
	const client = new SbxClient({ baseUrl: env.SBX_URL, apiKey: env.SBX_API_KEY });

	const info = await client.createSandbox({
		template: env.SBX_TEMPLATE ?? TOOLCHAIN,
		cpu: CPUS,
		memoryMb: MEMORY_MB,
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
		emit({ type: 'sandbox.ready', data: { ms: Date.now() - started, id } });
		await runSetup(config, run, emit);
	} catch (error) {
		await close();
		throw error;
	}

	return { runner: { run: (command, { timeoutMs }) => run(command, timeoutMs) }, close };
}
