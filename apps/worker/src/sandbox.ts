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
/** Names the per-review volume that holds /workspace, so leftovers can be found and removed. */
const VOLUME_PREFIX = 'hansi-';
/**
 * Files over this size stay out of the sandbox. They are assets, fixtures, and binaries that
 * commands rarely need, and a few of them can fill sbx's archive limit (256 MiB by default).
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
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
 * network. Composer comes from its installer and Go from mise, since builds cannot copy files
 * out of other images.
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
	.run('curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh')
	.withEnv({ MISE_DATA_DIR: '/opt/mise' })
	// Links the binaries onto PATH, so commands need no mise at run time.
	.run('mise install go@1.25 && ln -s "$(mise where go@1.25)"/bin/* /usr/local/bin/');

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

/**
 * Writes the checkout at HEAD to a tar file, without files over `maxFileBytes`, and returns the
 * paths it left out. A tree, not a commit: sbx rejects the pax header with the commit id that a
 * commit gets. Sizes come from git's objects, which the checkout already has.
 */
export async function archiveCheckout(
	repoDir: string,
	output: string,
	maxFileBytes = MAX_FILE_BYTES
): Promise<string[]> {
	const listing = await git(['ls-tree', '-r', '-l', '-z', 'HEAD'], { cwd: repoDir });
	const omitted = listing.split('\0').flatMap((entry) => {
		// "<mode> <type> <object> <size>\t<path>"; the size is "-" for submodules.
		const tab = entry.indexOf('\t');
		const size = Number(entry.slice(0, tab).trim().split(/\s+/)[3]);
		return tab > 0 && size > maxFileBytes ? [entry.slice(tab + 1)] : [];
	});
	const excludes = omitted.map((path) => `:(exclude,literal)${path}`);
	await git(
		['archive', '--format=tar', `--output=${output}`, 'HEAD^{tree}', '--', '.', ...excludes],
		{
			cwd: repoDir
		}
	);
	return omitted;
}

/**
 * Deletes volumes of reviews whose sandbox sbx has already removed, e.g. after this worker
 * crashed. Any volume older than the sandbox lifetime is one: sbx refuses to delete a volume a
 * live sandbox still mounts.
 */
async function removeStaleVolumes(client: SbxClient, log: Logger): Promise<void> {
	const volumes = await client.listVolumes().catch(() => []);
	const cutoff = Date.now() - 2 * MAX_LIFETIME_SECONDS * 1000;
	for (const volume of volumes) {
		if (!volume.name.startsWith(VOLUME_PREFIX) || Date.parse(volume.createdAt) > cutoff) continue;
		await client.deleteVolume(volume.id).catch((error: unknown) => {
			log.debug({ err: error, volume: volume.id }, 'stale sbx volume not deleted');
		});
	}
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

	await removeStaleVolumes(client, log);
	// /workspace is a volume, on disk: sbx's default is a tmpfs, which would count the checkout
	// and installed dependencies against the sandbox's memory.
	// A retry after this worker died finds the last attempt's volume still there, so each attempt
	// gets its own name. removeStaleVolumes deletes the leftovers.
	const volume = await client.createVolume(
		`${VOLUME_PREFIX}${name}-${crypto.randomUUID().slice(0, 8)}`
	);
	const removeVolume = () =>
		client.deleteVolume(volume.id).catch((error: unknown) => {
			if (!gone(error)) log.warn({ err: error, volume: volume.id }, 'sbx volume delete failed');
		});
	const info = await client
		.createSandbox({
			template: env.SBX_TEMPLATE ?? TOOLCHAIN,
			cpu: CPUS,
			memoryMb: MEMORY_MB,
			mounts: [{ volumeId: volume.id, path: WORKSPACE }],
			ttl: MAX_LIFETIME_SECONDS,
			network: { mode: config.sandbox.network === 'public' ? 'full' : 'none' },
			env: { CI: 'true' },
			labels: { 'hansi.job': name }
		})
		.catch(async (error: unknown) => {
			await removeVolume();
			throw error;
		});
	const id = info.id;

	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		await client.deleteSandbox(id).catch((error: unknown) => {
			if (!gone(error)) log.warn({ err: error, id }, 'sbx sandbox delete failed');
		});
		await removeVolume();
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
		let omitted: string[];
		try {
			omitted = await archiveCheckout(repoDir, archive);
			const tar = trimTar(await readFile(archive));
			await client.uploadArchive(id, WORKSPACE, Bun.gzipSync(tar)).catch((error: unknown) => {
				if (error instanceof SbxError && error.status === 413) {
					throw new Error(
						`The checkout is ${Math.ceil(tar.length / 2 ** 20)} MiB, more than the sbx server accepts (SBX_MAX_ARCHIVE_BYTES): ${error.message}`,
						{ cause: error }
					);
				}
				throw error;
			});
		} finally {
			await rm(archive, { force: true });
		}
		emit({
			type: 'sandbox.ready',
			data: {
				ms: Date.now() - started,
				id,
				omitted: omitted.length,
				omittedFiles: omitted.slice(0, 20)
			}
		});
		await runSetup(config, run, emit);
	} catch (error) {
		await close();
		throw error;
	}

	return { runner: { run: (command, { timeoutMs }) => run(command, timeoutMs) }, close };
}
