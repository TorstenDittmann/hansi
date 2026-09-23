export class GitError extends Error {
	constructor(
		readonly args: string[],
		readonly exitCode: number,
		readonly stderr: string
	) {
		super(`git ${args[0]} failed (${exitCode}): ${stderr.trim().slice(0, 500)}`);
	}
}

interface GitOptions {
	cwd?: string;
	/** Installation token; sent as a header so it never lands in `.git/config` or logs. */
	token?: string;
	signal?: AbortSignal;
}

export async function git(args: string[], options: GitOptions = {}): Promise<string> {
	const auth = options.token
		? [
				'-c',
				`http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${options.token}`).toString('base64')}`
			]
		: [];

	const proc = Bun.spawn(['git', ...auth, ...args], {
		cwd: options.cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		signal: options.signal,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' }
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	]);
	if (exitCode !== 0) throw new GitError(args, exitCode, stderr);
	return stdout;
}

export interface CheckoutOptions {
	dir: string;
	cloneUrl: string;
	token?: string;
	pullNumber: number;
	baseSha: string;
	headSha: string;
	signal?: AbortSignal;
}

/**
 * Checks out a pull request's head and returns its diff against the merge base (what GitHub
 * shows in "Files changed"). Uses a blobless clone: full history for the merge base, but file
 * contents are only downloaded for the checked-out tree.
 */
export async function checkoutPullRequest(options: CheckoutOptions): Promise<string> {
	const { dir, token, signal } = options;
	await git(['init', '--quiet', dir], { signal });
	await git(['remote', 'add', 'origin', options.cloneUrl], { cwd: dir, signal });
	// `pull/N/head` also covers PRs from forks, whose head commit is not on any branch here.
	await git(
		[
			'fetch',
			'--quiet',
			'--no-tags',
			'--filter=blob:none',
			'origin',
			options.baseSha,
			`+refs/pull/${options.pullNumber}/head:refs/remotes/origin/pr`
		],
		{ cwd: dir, token, signal }
	);
	await git(['checkout', '--quiet', '--detach', options.headSha], { cwd: dir, token, signal });
	return git(
		[
			'diff',
			'--no-color',
			'--no-ext-diff',
			'--find-renames',
			`${options.baseSha}...${options.headSha}`
		],
		{ cwd: dir, token, signal }
	);
}

/**
 * Diff of the commits since `fromSha` (a previously reviewed head), or `null` when that commit
 * is gone or no longer an ancestor of `headSha`, e.g. after a force-push or rebase.
 */
export async function diffSince(options: {
	dir: string;
	fromSha: string;
	headSha: string;
	token?: string;
	signal?: AbortSignal;
}): Promise<string | null> {
	const { dir, fromSha, headSha, token, signal } = options;
	try {
		await git(['cat-file', '-e', `${fromSha}^{commit}`], { cwd: dir, signal }).catch(() =>
			git(['fetch', '--quiet', '--no-tags', '--filter=blob:none', 'origin', fromSha], {
				cwd: dir,
				token,
				signal
			})
		);
		await git(['merge-base', '--is-ancestor', fromSha, headSha], { cwd: dir, signal });
	} catch (error) {
		if (error instanceof GitError) return null;
		throw error;
	}
	return git(['diff', '--no-color', '--no-ext-diff', '--find-renames', `${fromSha}..${headSha}`], {
		cwd: dir,
		token,
		signal
	});
}
