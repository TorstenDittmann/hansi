import { rm } from 'node:fs/promises';
import type { Env, RepoConfig } from '@hans/config';
import { git, type CommandResult, type CommandRunner, type EmitEvent } from '@hans/core';
import type { Logger } from 'pino';
import { dockerClient } from './docker';

/** Where the pull request's files are unpacked in the container, and where commands run. */
const WORKSPACE = '/workspace';
const SETUP_TIMEOUT_MS = 10 * 60_000;
/** The container exits after this long even if the review is still running. */
const MAX_LIFETIME_SECONDS = 60 * 60;
/** `timeout -s KILL` exits with 128 + SIGKILL. */
const KILLED_BY_TIMEOUT = 137;

export interface ReviewSandbox {
	runner: CommandRunner;
	close(): Promise<void>;
}

/** Why reviews on this instance run without a sandbox, or null when they get one. */
export function sandboxSkipReason(env: Pick<Env, 'SANDBOX'>): string | null {
	return env.SANDBOX === 'off' ? 'SANDBOX=off on this instance' : null;
}

/**
 * Starts a container for one review, under gVisor (`runsc`): its own user-space kernel between
 * the pull request's code and the host. Every pull request gets one, including those from people
 * without write access; the container holds no credentials and is capped in CPU, memory,
 * processes, and lifetime. It gets the checkout at HEAD without `.git`, so nothing in it can
 * touch the history the review reads its trusted rules from. Then it runs the setup command.
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
	const docker = dockerClient(env.SANDBOX_DOCKER_HOST);
	const { image } = config.sandbox;
	const started = Date.now();

	if (!(await docker.hasImage(image))) await docker.pull(image);
	const id = await docker.create(name, {
		Image: image,
		// Exits on its own once its lifetime is up, even if the worker dies before cleaning up.
		Entrypoint: ['sleep'],
		Cmd: [String(MAX_LIFETIME_SECONDS)],
		WorkingDir: WORKSPACE,
		Labels: { 'codes.hansi.sandbox': 'true' },
		HostConfig: {
			Runtime: env.SANDBOX_RUNTIME,
			AutoRemove: true,
			NanoCpus: 2_000_000_000,
			Memory: 2 * 1024 ** 3,
			PidsLimit: 1024,
			NetworkMode: config.sandbox.network === 'none' ? 'none' : 'bridge'
		}
	});
	const close = async () => {
		await docker
			.remove(id)
			.catch((error: unknown) => log.warn({ err: error }, 'sandbox removal failed'));
	};

	const run = async (command: string, timeoutMs: number): Promise<CommandResult> => {
		const seconds = Math.ceil(timeoutMs / 1000);
		const began = Date.now();
		const result = await docker.exec(
			id,
			['timeout', '-s', 'KILL', String(seconds), 'sh', '-c', command],
			// The in-container timeout fires first; this only guards a stuck connection.
			{ workdir: WORKSPACE, signal: AbortSignal.timeout(timeoutMs + 30_000) }
		);
		const timedOut = result.exitCode === KILLED_BY_TIMEOUT && Date.now() - began >= timeoutMs;
		return { ...result, exitCode: timedOut ? null : result.exitCode, timedOut };
	};

	const archive = `${repoDir}.tar`;
	try {
		await git(['archive', '--format=tar', '--prefix=workspace/', `--output=${archive}`, 'HEAD'], {
			cwd: repoDir
		});
		await docker.putArchive(id, '/', await Bun.file(archive).bytes());
		await docker.start(id);
		emit({ type: 'sandbox.ready', data: { image, ms: Date.now() - started } });

		if (config.sandbox.setup.trim()) {
			const setup = await run(config.sandbox.setup, SETUP_TIMEOUT_MS);
			// A failed setup still leaves a usable container: the model sees the failure itself.
			emit({
				type: 'sandbox.setup',
				data: { command: config.sandbox.setup, exitCode: setup.exitCode, timedOut: setup.timedOut }
			});
		}
	} catch (error) {
		await close();
		throw error;
	} finally {
		await rm(archive, { force: true });
	}

	return { runner: { run: (command, { timeoutMs }) => run(command, timeoutMs) }, close };
}
