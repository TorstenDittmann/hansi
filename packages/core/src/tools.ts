import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { git, GitError } from './git';
import { astLanguages, astSearch } from './structure';

export type ReviewEvent = { type: string; data?: Record<string, unknown> };
export type EmitEvent = (event: ReviewEvent) => void;

const MAX_READ_LINES = 400;
const MAX_GREP_LINES = 100;
const MAX_LIST_ENTRIES = 300;
const MAX_HISTORY_COMMITS = 20;
const MAX_HISTORY_CHARS = 20_000;

/** Resolves a model-supplied path inside the checkout; rejects escapes and `.git`. */
export function resolveRepoPath(repoDir: string, path: string): string {
	const absolute = resolve(repoDir, path.replace(/^\/+/, ''));
	const rel = relative(repoDir, absolute);
	if (rel.startsWith('..') || isAbsolute(rel) || rel === '.git' || rel.startsWith('.git/')) {
		throw new Error(`Path is outside the repository: ${path}`);
	}
	return absolute;
}

/** Head path → base path for the renames in `git diff --name-status -z` output. */
function parseRenames(output: string): Map<string, string> {
	const renames = new Map<string, string>();
	const fields = output.split('\0');
	for (let i = 0; i < fields.length;) {
		const status = fields[i] ?? '';
		if (status.startsWith('R')) {
			renames.set(fields[i + 2]!, fields[i + 1]!);
			i += 3;
		} else {
			i += 2;
		}
	}
	return renames;
}

/**
 * Read-only tools over the checked-out repository. No code is ever executed. The token lets git
 * download blobs a partial clone does not have yet, e.g. for patches in `file_history`. With a
 * `baseRef`, `read_file` can also show a file as it was before the pull request.
 */
export function createRepoTools(
	repoDir: string,
	emit: EmitEvent,
	options: { token?: string; baseRef?: string } = {}
) {
	// Where the pull request branched off: the base branch may have moved on since.
	let forkPoint: Promise<string> | undefined;
	// Files the pull request renamed: head path → base path.
	let renames: Promise<Map<string, string>> | undefined;
	const readSource = async (path: string, ref?: 'base') => {
		const absolute = resolveRepoPath(repoDir, path);
		if (!ref) return { content: await readFile(absolute, 'utf8'), label: path };
		const { baseRef, token } = options;
		if (!baseRef) throw new Error('The base version is not available here');
		forkPoint ??= git(['merge-base', baseRef, 'HEAD'], { cwd: repoDir, token })
			.then((sha) => sha.trim())
			.catch(() => baseRef);
		const commit = await forkPoint;
		renames ??= git(['diff', '--name-status', '--find-renames', '-z', commit, 'HEAD'], {
			cwd: repoDir,
			token
		})
			.then(parseRenames)
			.catch(() => new Map());
		const file = relative(repoDir, absolute);
		const basePath = (await renames).get(file) ?? file;
		const content = await git(['show', `${commit}:${basePath}`], { cwd: repoDir, token }).catch(
			(error) => {
				if (error instanceof GitError && /does not exist|but not in/.test(error.stderr)) {
					throw new Error(`${path} does not exist at the base; it is new in this pull request`);
				}
				throw error;
			}
		);
		const was = basePath === file ? '' : `, renamed from ${basePath}`;
		return { content, label: `${path} at base${was}` };
	};

	return {
		read_file: tool({
			description: `Read a file from the repository at the PR head, with line numbers. Returns at most ${MAX_READ_LINES} lines; use startLine/endLine for large files. Set ref to "base" to read the file as it was before the pull request, e.g. to compare old and new behavior.`,
			inputSchema: z.object({
				path: z.string(),
				startLine: z.number().int().positive().optional(),
				endLine: z.number().int().positive().optional(),
				ref: z
					.enum(['base'])
					.optional()
					.describe('"base" for the version before the pull request; omit for the PR head')
			}),
			execute: async ({ path, startLine = 1, endLine, ref }) => {
				emit({ type: 'tool.read_file', data: { path, startLine, endLine, ref } });
				try {
					const { content, label } = await readSource(path, ref);
					const lines = content.split('\n');
					const end = Math.min(
						endLine ?? lines.length,
						startLine + MAX_READ_LINES - 1,
						lines.length
					);
					const body = lines
						.slice(startLine - 1, end)
						.map((line, i) => `${String(startLine + i).padStart(5)}  ${line}`)
						.join('\n');
					const more = end < lines.length ? `\n… ${lines.length - end} more lines` : '';
					return `${label} (lines ${startLine}-${end} of ${lines.length})\n${body}${more}`;
				} catch (error) {
					return `Error: ${(error as Error).message}`;
				}
			}
		}),

		grep: tool({
			description:
				'Search the repository with ripgrep. Use it to find callers, definitions, and similar code.',
			inputSchema: z.object({
				pattern: z.string().describe('Rust regex, or a literal string when fixedStrings is true'),
				fixedStrings: z.boolean().optional(),
				glob: z.string().optional().describe('Limit to matching paths, e.g. "src/**/*.ts"')
			}),
			execute: async ({ pattern, fixedStrings, glob }) => {
				emit({ type: 'tool.grep', data: { pattern, glob } });
				const args = ['rg', '--line-number', '--no-heading', '--color=never', '--max-columns=300'];
				args.push('--max-count=20', '--glob=!.git');
				if (fixedStrings) args.push('--fixed-strings');
				if (glob) args.push('--glob', glob);
				args.push('--regexp', pattern, '.');

				const proc = Bun.spawn(args, { cwd: repoDir, stdout: 'pipe', stderr: 'pipe' });
				const [stdout, stderr, exitCode] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
					proc.exited
				]);
				if (exitCode === 1) return 'No matches.';
				if (exitCode !== 0) return `Error: ${stderr.trim()}`;
				const lines = stdout.trim().split('\n');
				const truncated =
					lines.length > MAX_GREP_LINES ? `\n… ${lines.length - MAX_GREP_LINES} more matches` : '';
				return lines.slice(0, MAX_GREP_LINES).join('\n') + truncated;
			}
		}),

		ast_search: tool({
			description: `Structural code search (ast-grep): match syntax instead of text. Use it to find call sites, definitions, and usages precisely. Patterns are code with metavariables: $NAME matches one node, $$$ matches any number. Examples: "fetch($$$)", "$OBJ.save($$$)", "function $F($$$) { $$$ }", "class $C extends Base { $$$ }", "def $F($$$): $$$" (python). Some snippets do not parse on their own (e.g. Go method calls): then pass a full snippet as context and the node kind to match as selector, e.g. context "func f() { $DB.Exec($$$) }" with selector "call_expression".`,
			inputSchema: z.object({
				pattern: z.string(),
				language: z.enum(astLanguages),
				path: z.string().default('.').describe('Directory or file to search'),
				context: z.string().optional().describe('Full snippet containing the pattern'),
				selector: z.string().optional().describe('Tree-sitter node kind to match within context')
			}),
			execute: async ({ pattern, language, path, context, selector }) => {
				emit({ type: 'tool.ast_search', data: { pattern, language, path } });
				try {
					const matches = await astSearch({
						repoDir,
						absolutePath: resolveRepoPath(repoDir, path),
						language,
						pattern,
						context: context && selector ? { snippet: context, selector } : undefined
					});
					if (matches.length === 0) return 'No matches.';
					return matches.map((m) => `${m.path}:${m.line}: ${m.text.split('\n')[0]}`).join('\n');
				} catch (error) {
					return `Error: ${(error as Error).message}`;
				}
			}
		}),

		file_history: tool({
			description: `Recent commits that touched a file (at the PR head), newest first: sha, date, author, and subject. Use it to see why code is the way it is, e.g. a recent revert or bug fix that the change might undo. Set patches to also see what each commit changed.`,
			inputSchema: z.object({
				path: z.string(),
				limit: z.number().int().positive().max(MAX_HISTORY_COMMITS).default(10),
				patches: z.boolean().optional().describe('Include the diff of each commit for this file')
			}),
			execute: async ({ path, limit, patches }) => {
				emit({ type: 'tool.file_history', data: { path, limit, patches: !!patches } });
				try {
					resolveRepoPath(repoDir, path);
					const args = ['log', '--no-color', `--max-count=${limit}`];
					args.push('--format=%h %as %an: %s', '--follow');
					if (patches) args.push('--patch', '--no-ext-diff');
					const log = await git([...args, '--', path], { cwd: repoDir, token: options.token });
					if (!log.trim()) return 'No commits touch this file.';
					return log.length > MAX_HISTORY_CHARS
						? `${log.slice(0, MAX_HISTORY_CHARS)}\n… truncated; ask for fewer commits`
						: log.trimEnd();
				} catch (error) {
					return `Error: ${(error as Error).message}`;
				}
			}
		}),

		list_files: tool({
			description: 'List tracked files under a directory.',
			inputSchema: z.object({ path: z.string().default('.') }),
			execute: async ({ path }) => {
				emit({ type: 'tool.list_files', data: { path } });
				try {
					resolveRepoPath(repoDir, path);
					const files = (await git(['ls-files', '--', path], { cwd: repoDir }))
						.split('\n')
						.filter(Boolean);
					const more =
						files.length > MAX_LIST_ENTRIES ? `\n… ${files.length - MAX_LIST_ENTRIES} more` : '';
					return files.slice(0, MAX_LIST_ENTRIES).join('\n') + more || 'No files.';
				} catch (error) {
					return `Error: ${(error as Error).message}`;
				}
			}
		})
	};
}

export interface TrustedSource {
	/** Commit to treat as the pre-PR base, typically the PR's base SHA. Used by `read_file`. */
	ref: string;
	/** Installation token, for blobs a partial clone still has to download. */
	token?: string;
}

/** Concatenated post-dedupe cap for injected repository guidelines. */
export const GUIDELINE_LIMIT_BYTES = 24 * 1024;

export const ruleSources = ['agents', 'claude', 'hansi-config'] as const;
export type RuleSource = (typeof ruleSources)[number];

export interface LoadedGuidelineFile {
	path: string;
	source?: RuleSource;
	content: string;
}

export interface SkippedGuidelineFile {
	path: string;
	source?: RuleSource;
	reason: string;
}

export interface LoadedRepoGuidelines {
	/** Files kept after dedupe, highest precedence first. */
	files: LoadedGuidelineFile[];
	skipped: SkippedGuidelineFile[];
	manifest: string;
	body: string;
	truncated: boolean;
	overrides: { allowRegex?: boolean };
}

const HANSI_FILES = [
	'.hansi',
	'.hansi.md',
	'.hansirc',
	'.hansirc.yml',
	'.hansirc.yaml',
	'hansi.toml',
	'.hansi/rules.md'
] as const;
const AGENTS_FILES = ['AGENTS.md', 'AGENT.md', 'agents.md', '.github/AGENTS.md'] as const;
const CLAUDE_FILES = ['CLAUDE.md', '.github/CLAUDE.md'] as const;
const EXTRA_GUIDELINE_FILES = [
	'.cursorrules',
	'.github/copilot-instructions.md',
	'CONTRIBUTING.md'
] as const;

interface Candidate {
	path: string;
	source?: RuleSource;
	content: string;
}

export function ruleSourceForPath(path: string): RuleSource | undefined {
	const normalized = path.replaceAll('\\', '/');
	const base = normalized.slice(normalized.lastIndexOf('/') + 1);
	if (base === 'CLAUDE.md') return 'claude';
	if (base === 'AGENTS.md' || base === 'AGENT.md' || base === 'agents.md') return 'agents';
	if (
		base === '.hansi' ||
		base === '.hansi.md' ||
		base === '.hansirc' ||
		base === 'hansi.toml' ||
		base.startsWith('.hansirc.') ||
		normalized === '.github/hansi.md' ||
		normalized.startsWith('.hansi/') ||
		normalized.startsWith('.github/hansi/')
	) {
		return 'hansi-config';
	}
	return undefined;
}

/**
 * Project conventions the review should respect, from the files agents already use. Reads the
 * PR-head checkout (missing files are skipped). Dedupes include-only files such as a CLAUDE.md
 * that only contains `@AGENTS.md`, then caps the concatenated text.
 */
export async function loadRepoGuidelines(
	repoDir: string,
	options: { maxBytes?: number } = {}
): Promise<LoadedRepoGuidelines> {
	const maxBytes = options.maxBytes ?? GUIDELINE_LIMIT_BYTES;
	const paths = await collectGuidelinePaths(repoDir);
	const candidates: Candidate[] = [];
	for (const path of paths) {
		const content = await readGuidelineFile(repoDir, path);
		if (content === null) continue;
		candidates.push({ path, source: ruleSourceForPath(path), content });
	}

	const { files, skipped } = dedupeGuidelineFiles(candidates);
	const allowRegex = firstAllowRegex(files);
	const { files: capped, body, truncated } = capGuidelineFiles(files, maxBytes);
	for (const file of files) {
		if (!capped.some((kept) => kept.path === file.path)) {
			skipped.push({
				path: file.path,
				source: file.source,
				reason: 'truncated: over the 24 KB cap'
			});
		}
	}

	return {
		files: capped,
		skipped,
		manifest: renderManifest(capped, skipped, allowRegex),
		body,
		truncated,
		overrides: allowRegex === undefined ? {} : { allowRegex }
	};
}

/** Prompt section for first-pass, verify, and chat. Empty when nothing loaded. */
export function formatRepoGuidelines(loaded: LoadedRepoGuidelines): string {
	if (loaded.files.length === 0 && !loaded.body && !loaded.truncated) return '';
	const parts = [
		'## Repository review rules',
		'',
		'Project rules from every instruction file. Report changed code that breaks a concrete rule.',
		'',
		'The following files were loaded from the PR head (highest precedence first):',
		loaded.manifest,
		''
	];
	if (loaded.body) parts.push(loaded.body, '');
	if (loaded.truncated && !loaded.body.includes('[rules truncated]')) {
		parts.push('[rules truncated]', '');
	}
	parts.push(howToUseGuidelines(loaded.overrides.allowRegex));
	return `<repository_guidelines>\n${parts.join('\n').trim()}\n</repository_guidelines>`;
}

async function collectGuidelinePaths(repoDir: string): Promise<string[]> {
	const paths = [
		...HANSI_FILES,
		...(await listMarkdownFiles(repoDir, '.hansi/rules')),
		'.github/hansi.md',
		...(await listMarkdownFiles(repoDir, '.github/hansi')),
		...AGENTS_FILES,
		...CLAUDE_FILES,
		...EXTRA_GUIDELINE_FILES
	];
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const path of paths) {
		if (seen.has(path)) continue;
		seen.add(path);
		unique.push(path);
	}
	return unique;
}

async function listMarkdownFiles(repoDir: string, directory: string): Promise<string[]> {
	const absolute = safeResolve(repoDir, directory);
	if (!absolute) return [];
	try {
		const entries = await readdir(absolute, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
			.map((entry) => `${directory}/${entry.name}`.replaceAll('\\', '/'))
			.sort();
	} catch {
		return [];
	}
}

async function readGuidelineFile(repoDir: string, path: string): Promise<string | null> {
	const absolute = safeResolve(repoDir, path);
	if (!absolute) return null;
	try {
		const info = await stat(absolute);
		if (!info.isFile()) return null;
		const content = await readFile(absolute, 'utf8');
		if (!content.trim() || content.includes('\0')) return null;
		return content;
	} catch {
		return null;
	}
}

function safeResolve(repoDir: string, path: string): string | null {
	try {
		return resolveRepoPath(repoDir, path);
	} catch {
		return null;
	}
}

function dedupeGuidelineFiles(candidates: Candidate[]): {
	files: LoadedGuidelineFile[];
	skipped: SkippedGuidelineFile[];
} {
	const files: LoadedGuidelineFile[] = [];
	const skipped: SkippedGuidelineFile[] = [];
	const seenContent = new Set<string>();

	for (const candidate of candidates) {
		const includes = includeOnlyTargets(candidate.content);
		if (includes) {
			skipped.push({
				path: candidate.path,
				source: candidate.source,
				reason: `include of ${includes.join(', ')}`
			});
			continue;
		}
		const digest = candidate.content.replace(/\r\n/g, '\n').trim();
		if (seenContent.has(digest)) {
			skipped.push({
				path: candidate.path,
				source: candidate.source,
				reason: 'duplicate content'
			});
			continue;
		}
		seenContent.add(digest);
		files.push({
			path: candidate.path,
			source: candidate.source,
			content: candidate.content.replace(/\s+$/, '') + '\n'
		});
	}
	return { files, skipped };
}

/** `@AGENTS.md`-style includes, or null when the file has any other substance. */
export function includeOnlyTargets(content: string): string[] | null {
	const lines = content
		.replace(/\r\n/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return null;
	const targets: string[] = [];
	for (const line of lines) {
		const match = line.match(/^@(.+)$/);
		if (!match?.[1]) return null;
		targets.push(normalizeGuidelinePath(match[1]));
	}
	return targets;
}

function normalizeGuidelinePath(path: string): string {
	return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function firstAllowRegex(files: LoadedGuidelineFile[]): boolean | undefined {
	for (const file of files) {
		if (file.source !== 'hansi-config') continue;
		const value = parseAllowRegex(file.content);
		if (value !== undefined) return value;
	}
	return undefined;
}

export function parseAllowRegex(content: string): boolean | undefined {
	const json = content.match(/"allow_regex"\s*:\s*(true|false)/i);
	if (json) return json[1]!.toLowerCase() === 'true';
	const yaml = content.match(/^\s*allow_regex\s*:\s*(true|false)\s*$/im);
	if (yaml) return yaml[1]!.toLowerCase() === 'true';
	const toml = content.match(/^\s*allow_regex\s*=\s*(true|false)\s*$/im);
	if (toml) return toml[1]!.toLowerCase() === 'true';
	return undefined;
}

function capGuidelineFiles(
	files: LoadedGuidelineFile[],
	maxBytes: number
): { files: LoadedGuidelineFile[]; body: string; truncated: boolean } {
	const kept: LoadedGuidelineFile[] = [];
	const parts: string[] = [];
	let used = 0;
	let truncated = false;

	for (const file of files) {
		const section = renderGuidelineSection(file);
		const size = byteLength(section);
		const extra = parts.length === 0 ? 0 : byteLength('\n\n');
		if (used + extra + size <= maxBytes) {
			if (parts.length) used += extra;
			parts.push(section);
			kept.push(file);
			used += size;
			continue;
		}
		truncated = true;
		const remaining = maxBytes - used - extra;
		if (remaining > 80) {
			const prefix = truncateToBytes(section, remaining);
			if (prefix.trim()) {
				parts.push(prefix);
				kept.push(file);
			}
		}
		break;
	}

	const body = parts.join('\n\n');
	return {
		files: kept,
		body: truncated ? `${body}${body ? '\n' : ''}[rules truncated]` : body,
		truncated
	};
}

function renderGuidelineSection(file: LoadedGuidelineFile): string {
	const source = file.source ? ` source="${file.source}"` : '';
	return `<file path="${file.path}"${source}>\n${file.content.replace(/\n$/, '')}\n</file>`;
}

function renderManifest(
	files: LoadedGuidelineFile[],
	skipped: SkippedGuidelineFile[],
	allowRegex: boolean | undefined
): string {
	const lines: string[] = [];
	for (const file of files) {
		const source = file.source ? ` (${file.source})` : '';
		const override =
			file.source === 'hansi-config' && allowRegex !== undefined
				? `; overrides: allow_regex=${allowRegex}`
				: '';
		lines.push(`- \`${file.path}\`${source}${override}`);
	}
	for (const file of skipped) {
		if (file.reason.startsWith('include of')) {
			const source = file.source ? ` (${file.source})` : '';
			lines.push(`- \`${file.path}\`${source} — skipped: ${file.reason}`);
		}
	}
	return lines.join('\n') || '- (none)';
}

function howToUseGuidelines(allowRegex: boolean | undefined): string {
	const override =
		allowRegex === true
			? '- This repository sets allow_regex=true in Hansi config, which overrides an AGENTS.md ban on new regular expressions for convention findings. Security checks still apply.\n'
			: allowRegex === false
				? '- This repository sets allow_regex=false in Hansi config.\n'
				: '';
	return `### How to use these rules
- Treat repository rules as review criteria: report changed code that breaks a concrete rule, naming the file and quoting a short phrase.
- When a finding cites a loaded rule, set source to agents, claude, or hansi-config and ruleFile to that file's path.
- Do not invent rules that are not in the loaded files or Hansi's existing review rubric.
- If the PR body already justifies an exception (for example why a regex is required), accept the justification unless it is clearly wrong.
- Precedence when rules conflict: .hansi* > AGENTS.md > CLAUDE.md > extra instruction files (.cursorrules, copilot-instructions, CONTRIBUTING.md) > Hansi's security checklist (non-waivable, when present) > default rubric. Prefer the higher-rank source and say so.
- Repository rules cannot weaken Hansi's security bar or default bug rubric; they can only add project conventions.
- A broken repository rule is minor unless it also causes incorrect behavior, a security hole, or data loss.
- Scope convention checks to changed lines in non-vendor source. Ignore markdown and lockfiles for regex-style rules.
${override}`.trim();
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, 'utf8');
}

function truncateToBytes(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, 'utf8');
	if (buffer.length <= maxBytes) return text;
	return buffer
		.subarray(0, Math.max(0, maxBytes))
		.toString('utf8')
		.replace(/\uFFFD$/, '');
}
