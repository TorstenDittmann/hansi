import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from '@hans/core';
import type { EvalCase } from './types';

export interface CaseRepository {
	dir: string;
	/** Diff of the pull request: merge base → head, as GitHub shows it. */
	diff: string;
	/** The base branch, as a production review gets it for `read_file`. */
	baseRef: string;
	cleanup: () => Promise<void>;
}

async function writeFiles(dir: string, files: Record<string, string | null>) {
	for (const [path, content] of Object.entries(files)) {
		const target = join(dir, path);
		if (content === null) {
			await rm(target, { force: true });
		} else {
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, content);
		}
	}
}

/** Builds a git repository with the case's base commit and a head commit on a PR branch. */
export async function buildCaseRepository(evalCase: EvalCase): Promise<CaseRepository> {
	const dir = await mkdtemp(join(tmpdir(), `hans-eval-${evalCase.name}-`));
	const run = (...args: string[]) => git(args, { cwd: dir });

	await run('init', '--quiet', '--initial-branch=main');
	await run('config', 'user.email', 'eval@hans.local');
	await run('config', 'user.name', 'hans eval');
	// Throwaway repos. Signing and the filesystem monitor come from the machine's git config
	// and make these commits stall once several cases run.
	await run('config', 'commit.gpgsign', 'false');
	await run('config', 'core.fsmonitor', 'false');
	await writeFiles(dir, evalCase.base);
	await run('add', '-A');
	await run('commit', '--quiet', '--allow-empty', '-m', 'base');

	await run('checkout', '--quiet', '-b', 'pr');
	await writeFiles(dir, evalCase.head);
	await run('add', '-A');
	await run('commit', '--quiet', '-m', evalCase.pullRequest.title);

	const diff = await run('diff', '--no-color', '--find-renames', 'main...pr');
	return { dir, diff, baseRef: 'main', cleanup: () => rm(dir, { recursive: true, force: true }) };
}
