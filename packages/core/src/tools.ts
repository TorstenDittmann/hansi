import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { git } from './git';
import { astLanguages, astSearch } from './structure';

export type ReviewEvent = { type: string; data?: Record<string, unknown> };
export type EmitEvent = (event: ReviewEvent) => void;

const MAX_READ_LINES = 400;
const MAX_GREP_LINES = 100;
const MAX_LIST_ENTRIES = 300;

/** Resolves a model-supplied path inside the checkout; rejects escapes and `.git`. */
export function resolveRepoPath(repoDir: string, path: string): string {
	const absolute = resolve(repoDir, path.replace(/^\/+/, ''));
	const rel = relative(repoDir, absolute);
	if (rel.startsWith('..') || isAbsolute(rel) || rel === '.git' || rel.startsWith('.git/')) {
		throw new Error(`Path is outside the repository: ${path}`);
	}
	return absolute;
}

/** Read-only tools over the checked-out repository. No code is ever executed. */
export function createRepoTools(repoDir: string, emit: EmitEvent) {
	return {
		read_file: tool({
			description: `Read a file from the repository at the PR head, with line numbers. Returns at most ${MAX_READ_LINES} lines; use startLine/endLine for large files.`,
			inputSchema: z.object({
				path: z.string(),
				startLine: z.number().int().positive().optional(),
				endLine: z.number().int().positive().optional()
			}),
			execute: async ({ path, startLine = 1, endLine }) => {
				emit({ type: 'tool.read_file', data: { path, startLine, endLine } });
				try {
					const lines = (await readFile(resolveRepoPath(repoDir, path), 'utf8')).split('\n');
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
					return `${path} (lines ${startLine}-${end} of ${lines.length})\n${body}${more}`;
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

const GUIDELINE_FILES = [
	'AGENTS.md',
	'CLAUDE.md',
	'.cursorrules',
	'.github/copilot-instructions.md',
	'CONTRIBUTING.md'
];
const MAX_GUIDELINE_CHARS = 20_000;

/** Project conventions the review should respect, from the files agents already use. */
export async function loadRepoGuidelines(repoDir: string): Promise<string> {
	const sections: string[] = [];
	let budget = MAX_GUIDELINE_CHARS;
	for (const file of GUIDELINE_FILES) {
		if (budget <= 0) break;
		const content = await readFile(resolve(repoDir, file), 'utf8').catch(() => null);
		if (!content?.trim()) continue;
		const excerpt = content.slice(0, budget);
		budget -= excerpt.length;
		sections.push(`<file path="${file}">\n${excerpt}\n</file>`);
	}
	return sections.join('\n\n');
}
