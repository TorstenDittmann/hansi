import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:net';
import { join } from 'node:path';
import type { Env, RepoConfig } from '@hans/config';
import { git, type CommandResult, type CommandRunner, type EmitEvent } from '@hans/core';
import { schema, type Database } from '@hans/db';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { startEgressProxy } from './egress-proxy';
import { openSbxSandbox } from './sbx-sandbox';
import { removeTree } from './shared';

/** Where the pull request's files are in the sandbox, and where commands run. */
export const WORKSPACE = '/workspace';
/** Where the egress proxy's socket appears in the sandbox. */
const PROXY_DIR = '/run/hansi';
const PROXY_PORT = 3128;
const SETUP_TIMEOUT_MS = 10 * 60_000;
/** The sandbox exits after this long even if the review is still running. */
export const MAX_LIFETIME_SECONDS = 60 * 60;
export const MEMORY_BYTES = 2 * 1024 ** 3;
/** `timeout -s KILL` exits with 128 + SIGKILL. */
const KILLED_BY_TIMEOUT = 137;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MEMORY_POLL_MS = 3_000;

export interface ReviewSandbox {
	runner: CommandRunner;
	close(): Promise<void>;
}

export interface OpenSandboxOptions {
	env: Env;
	config: RepoConfig;
	repoDir: string;
	name: string;
	emit: EmitEvent;
	log: Logger;
}

/** Starts one review's sandbox where `SANDBOX_PROVIDER` says: in this container, or on sbx. */
export function openSandbox(options: OpenSandboxOptions): Promise<ReviewSandbox> {
	return options.env.SANDBOX_PROVIDER === 'sbx'
		? openSbxSandbox(options)
		: openGvisorSandbox(options);
}

/**
 * Runs `command` under `timeout -s KILL` in the sandbox, through `exec`, which returns null as
 * the exit code when it had to give up itself. The in-sandbox timeout fires first, so whatever
 * the command printed before it was killed is kept.
 */
export async function runWithTimeout(
	exec: (args: string[], timeoutMs: number) => Promise<Spawned>,
	command: string,
	timeoutMs: number
): Promise<CommandResult> {
	const began = Date.now();
	const seconds = String(Math.ceil(timeoutMs / 1000));
	// The host-side timeout only guards a stuck runtime.
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
export async function runSetup(
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

/** Whether an organization's reviews and replies get a sandbox: on unless its settings turn it off. */
export async function sandboxEnabled(db: Database, organizationId: string): Promise<boolean> {
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

/** The OCI runtime spec for one review's sandbox. */
export function sandboxSpec(options: { rootfs: string; workspace: string; proxyDir: string }) {
	const proxy = `http://127.0.0.1:${PROXY_PORT}`;
	return {
		ociVersion: '1.0.0',
		process: {
			user: { uid: 0, gid: 0 },
			// Keeps the sandbox alive for `runsc exec`, and ends it once its lifetime is up.
			args: ['sleep', String(MAX_LIFETIME_SECONDS)],
			env: [
				'PATH=/usr/local/go/bin:/root/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
				'HOME=/root',
				'CI=true',
				...['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].map(
					(key) => `${key}=${proxy}`
				),
				'NO_PROXY=localhost,127.0.0.1',
				'no_proxy=localhost,127.0.0.1'
			],
			cwd: WORKSPACE
		},
		root: { path: options.rootfs, readonly: false },
		hostname: 'sandbox',
		mounts: [
			{ destination: '/proc', type: 'proc', source: 'proc' },
			{ destination: '/tmp', type: 'tmpfs', source: 'tmpfs', options: ['nosuid', 'nodev'] },
			{ destination: WORKSPACE, type: 'bind', source: options.workspace, options: ['rbind', 'rw'] },
			{ destination: PROXY_DIR, type: 'bind', source: options.proxyDir, options: ['rbind', 'rw'] }
		],
		linux: {
			resources: { memory: { limit: MEMORY_BYTES } },
			namespaces: ['pid', 'network', 'ipc', 'uts', 'mount'].map((type) => ({ type }))
		}
	};
}

/** Memory in use, from `runsc events --stats` output, or null when it cannot be read. */
export function memoryUsage(output: string): number | null {
	try {
		const usage = JSON.parse(output)?.data?.memory?.usage?.usage;
		return typeof usage === 'number' ? usage : null;
	} catch {
		return null;
	}
}

export interface Spawned {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

async function spawn(args: string[], timeoutMs?: number): Promise<Spawned> {
	// Lowest CPU priority: a busy sandbox must not starve the web app and the worker.
	const proc = Bun.spawn(['nice', '-n', '19', ...args], {
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: timeoutMs,
		killSignal: 'SIGKILL'
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		readTail(proc.stdout),
		readTail(proc.stderr),
		proc.exited
	]);
	return { exitCode, stdout, stderr };
}

/**
 * Reads a stream but keeps only its last MAX_OUTPUT_BYTES: commands run untrusted code, which
 * can print far more than the worker should hold in memory.
 */
export async function readTail(
	stream: ReadableStream<Uint8Array>,
	max = MAX_OUTPUT_BYTES
): Promise<string> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of stream) {
		chunks.push(chunk);
		size += chunk.length;
		while (size - chunks[0]!.length >= max) size -= chunks.shift()!.length;
	}
	const bytes = Buffer.concat(chunks);
	return bytes.subarray(Math.max(0, bytes.length - max)).toString('utf8');
}

/**
 * For `--detach`: the processes it leaves running inherit its stdio, so pipes would never close.
 * Errors go to a file instead, read once runsc itself has exited.
 */
async function spawnDetached(args: string[], errorLog: string): Promise<Spawned> {
	const proc = Bun.spawn(['nice', '-n', '19', ...args], {
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: Bun.file(errorLog),
		timeout: 60_000,
		killSignal: 'SIGKILL'
	});
	const exitCode = await proc.exited;
	const stderr = await Bun.file(errorLog)
		.text()
		.catch(() => '');
	return { exitCode, stdout: '', stderr };
}

/**
 * Starts a gVisor sandbox for one review, inside this container: `runsc` gives it its own
 * user-space kernel, so the pull request's code never runs on the host kernel. It needs no
 * Docker, no KVM, and no privileges (only seccomp unconfined, so runsc can set up its own
 * filters). Every pull request gets one, including those from people without write access:
 *
 * - The root filesystem is the toolchain image baked into this image, with a per-review
 *   writable layer on top. The checkout at HEAD, without `.git`, is at /workspace.
 * - It has no network. Its only way out is the egress proxy: HTTP(S) to public hosts on
 *   ports 80 and 443, enough to install dependencies.
 * - It holds no credentials and ends after an hour.
 */
async function openGvisorSandbox(options: OpenSandboxOptions): Promise<ReviewSandbox> {
	const { env, config, repoDir, name, emit, log } = options;
	const started = Date.now();
	const dir = `${repoDir}.sandbox`;
	const paths = {
		bundle: join(dir, 'bundle'),
		state: join(dir, 'state'),
		upper: join(dir, 'upper'),
		workspace: join(dir, 'workspace'),
		proxyDir: join(dir, 'proxy')
	};
	const runsc = [
		env.SANDBOX_RUNSC,
		'--rootless',
		'--ignore-cgroups',
		'--network=none',
		'--host-uds=open',
		`--overlay2=root:dir=${paths.upper}`,
		`--root=${paths.state}`
	];

	let proxy: Server | undefined;
	let running = false;
	let watchdog: ReturnType<typeof setInterval> | undefined;
	/** Set once the sandbox was stopped for using too much memory; later commands fail with it. */
	let stopped: string | undefined;
	const close = async () => {
		clearInterval(watchdog);
		if (running) {
			running = false;
			await spawn([...runsc, 'delete', '--force', name]).catch((error: unknown) =>
				log.warn({ err: error }, 'sandbox delete failed')
			);
		}
		proxy?.close();
		await removeTree(dir).catch((error: unknown) =>
			log.warn({ err: error, dir }, 'sandbox cleanup failed')
		);
	};

	const exec = (args: string[], timeoutMs?: number) =>
		spawn([...runsc, 'exec', `--cwd=${WORKSPACE}`, name, ...args], timeoutMs);

	const run = async (command: string, timeoutMs: number): Promise<CommandResult> => {
		if (stopped) throw new Error(stopped);
		const result = await runWithTimeout(exec, command, timeoutMs);
		if (stopped) throw new Error(stopped);
		return result;
	};

	try {
		await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
		const archive = `${dir}/workspace.tar`;
		await git(['archive', '--format=tar', `--output=${archive}`, 'HEAD'], { cwd: repoDir });
		const untar = await spawn(['tar', '-xf', archive, '-C', paths.workspace]);
		if (untar.exitCode !== 0) throw new Error(`Unpacking the checkout failed: ${untar.stderr}`);
		await rm(archive);

		if (config.sandbox.network === 'public') {
			proxy = await startEgressProxy(join(paths.proxyDir, 'proxy.sock'), (target) =>
				log.debug({ target }, 'sandbox egress')
			);
		}
		const spec = sandboxSpec({
			rootfs: env.SANDBOX_ROOTFS,
			workspace: paths.workspace,
			proxyDir: paths.proxyDir
		});
		await writeFile(join(paths.bundle, 'config.json'), JSON.stringify(spec));

		const errorLog = join(dir, 'runsc.log');
		const boot = await spawnDetached(
			[...runsc, 'run', '--detach', `--bundle=${paths.bundle}`, name],
			errorLog
		);
		if (boot.exitCode !== 0) throw new Error(`runsc failed to start: ${boot.stderr.trim()}`);
		running = true;
		// Without cgroups runsc cannot cap memory, so a watchdog stops the sandbox past the limit.
		watchdog = setInterval(async () => {
			if (!running || stopped) return;
			const stats = await spawn([...runsc, 'events', '--stats', name], 10_000).catch(() => null);
			const usage = stats ? memoryUsage(stats.stdout) : null;
			if (usage === null || usage <= MEMORY_BYTES) return;
			stopped = `The sandbox was stopped: it used more than ${MEMORY_BYTES / 1024 ** 3} GiB of memory.`;
			log.warn({ usage }, 'sandbox over memory limit');
			emit({ type: 'sandbox.stopped', data: { reason: 'memory', bytes: usage } });
			await spawn([...runsc, 'delete', '--force', name]).catch(() => {});
			running = false;
		}, MEMORY_POLL_MS);
		if (proxy) {
			// Bridges the proxy's socket to 127.0.0.1:3128, where the tools inside expect it.
			const bridge = await spawnDetached(
				[...runsc, 'exec', '--detach', name, 'node', '/opt/hansi/bridge.mjs'],
				errorLog
			);
			if (bridge.exitCode !== 0) throw new Error(`Proxy bridge failed: ${bridge.stderr.trim()}`);
		}
		emit({ type: 'sandbox.ready', data: { ms: Date.now() - started } });

		await runSetup(config, run, emit);
	} catch (error) {
		await close();
		throw error;
	}

	return { runner: { run: (command, { timeoutMs }) => run(command, timeoutMs) }, close };
}
