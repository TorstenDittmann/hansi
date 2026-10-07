import { rm } from 'node:fs/promises';
import type { Env, RepoConfig } from '@hans/config';
import { git, type CommandResult, type CommandRunner, type EmitEvent } from '@hans/core';
import type { Logger } from 'pino';

/** Where the pull request's files are unpacked in the VM, and where commands run. */
const WORKSPACE = '/workspace';
const SETUP_TIMEOUT_MS = 10 * 60_000;
/** The VM is stopped after this long even if the review is still running. */
const MAX_LIFETIME_SECONDS = 30 * 60;

export interface ReviewSandbox {
	runner: CommandRunner;
	close(): Promise<void>;
}

/**
 * Why a review runs without a sandbox, or null when it may get one. The worker also checks the
 * author: pull requests from people without write access never get one, since their code would
 * run on this instance's hardware.
 */
export function sandboxSkipReason(
	env: Pick<Env, 'SANDBOX' | 'MSB_API_KEY'>,
	config: RepoConfig
): string | null {
	if (!config.sandbox.enabled) return 'disabled in .hansi.json';
	if (env.SANDBOX === 'off') return 'no sandbox backend on this instance';
	if (env.SANDBOX === 'cloud' && !env.MSB_API_KEY) return 'SANDBOX=cloud without MSB_API_KEY';
	return null;
}

/**
 * Boots a microsandbox VM with a copy of the checkout at HEAD (without `.git`, so nothing in the
 * VM can touch the history the review reads its trusted rules from) and runs the setup command.
 */
export async function openSandbox(options: {
	env: Env;
	config: RepoConfig;
	repoDir: string;
	name: string;
	emit: EmitEvent;
	log: Logger;
}): Promise<ReviewSandbox> {
	const { env, config, repoDir, name, emit, log } = options;
	// Loaded only when a review asks for it: the native module is not needed otherwise.
	const { Sandbox, ExecTimeoutError, setDefaultBackend } = await import('microsandbox');
	setDefaultBackend(
		env.SANDBOX === 'cloud' ? { kind: 'cloud', apiKey: env.MSB_API_KEY! } : 'local'
	);

	const archive = `${repoDir}.tar`;
	await git(['archive', '--format=tar', `--output=${archive}`, 'HEAD'], { cwd: repoDir });

	let builder = Sandbox.builder(name)
		.image(config.sandbox.image)
		.cpus(2)
		.memory(2048)
		.maxDuration(MAX_LIFETIME_SECONDS)
		.ephemeral(true)
		.replace();
	if (config.sandbox.network === 'none') builder = builder.disableNetwork();

	const started = Date.now();
	const sandbox = await builder.create().catch(async (error: unknown) => {
		await rm(archive, { force: true });
		throw error;
	});
	const close = async () => {
		await sandbox.kill().catch((error: unknown) => log.warn({ err: error }, 'sandbox kill failed'));
		await rm(archive, { force: true });
	};

	const run = async (command: string, timeoutMs: number): Promise<CommandResult> => {
		try {
			const output = await sandbox.execWith('sh', (e) =>
				e.args(['-c', command]).cwd(WORKSPACE).timeout(timeoutMs)
			);
			return {
				exitCode: output.code,
				stdout: output.stdout(),
				stderr: output.stderr(),
				timedOut: false
			};
		} catch (error) {
			if (error instanceof ExecTimeoutError) {
				return { exitCode: null, stdout: '', stderr: '', timedOut: true };
			}
			throw error;
		}
	};

	try {
		await sandbox.fs().copyFromHost(archive, '/tmp/workspace.tar');
		const unpack = await sandbox.execWith('sh', (e) =>
			e.args(['-c', `mkdir -p ${WORKSPACE} && tar -xf /tmp/workspace.tar -C ${WORKSPACE}`])
		);
		if (unpack.code !== 0) throw new Error(`Unpacking the checkout failed: ${unpack.stderr()}`);
		emit({
			type: 'sandbox.ready',
			data: { image: config.sandbox.image, ms: Date.now() - started }
		});

		if (config.sandbox.setup.trim()) {
			const setup = await run(config.sandbox.setup, SETUP_TIMEOUT_MS);
			// A failed setup still leaves a usable VM: the model sees the failure in its commands.
			emit({
				type: 'sandbox.setup',
				data: { command: config.sandbox.setup, exitCode: setup.exitCode, timedOut: setup.timedOut }
			});
		}
	} catch (error) {
		await close();
		throw error;
	}

	return { runner: { run: (command, { timeoutMs }) => run(command, timeoutMs) }, close };
}
