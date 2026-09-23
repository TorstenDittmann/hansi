import type { FileDiff } from './diff';

/** Files that are almost never worth an LLM's attention. */
export const defaultIgnoreGlobs = [
	'**/*.lock',
	'**/package-lock.json',
	'**/pnpm-lock.yaml',
	'**/yarn.lock',
	'**/bun.lock',
	'**/bun.lockb',
	'**/Cargo.lock',
	'**/go.sum',
	'**/poetry.lock',
	'**/composer.lock',
	'**/Gemfile.lock',
	'**/*.min.js',
	'**/*.min.css',
	'**/*.map',
	'**/*.snap',
	'**/dist/**',
	'**/build/**',
	'**/vendor/**',
	'**/node_modules/**',
	'**/*.generated.*',
	'**/*.pb.go',
	'**/*.svg',
	'**/*.png',
	'**/*.jpg',
	'**/*.gif',
	'**/*.ico',
	'**/*.pdf',
	'**/*.woff',
	'**/*.woff2'
];

export interface FilterResult {
	included: FileDiff[];
	excluded: { path: string; reason: string }[];
}

/**
 * Applies default ignores plus `.hans.yml` path filters. Filters without `!` are an allowlist;
 * filters with `!` exclude. User filters can re-include a default-ignored path.
 */
export function filterFiles(files: FileDiff[], pathFilters: string[] = []): FilterResult {
	const includes = pathFilters.filter((f) => !f.startsWith('!')).map((f) => new Bun.Glob(f));
	const excludes = pathFilters
		.filter((f) => f.startsWith('!'))
		.map((f) => new Bun.Glob(f.slice(1)));
	const defaults = defaultIgnoreGlobs.map((g) => new Bun.Glob(g));

	const result: FilterResult = { included: [], excluded: [] };
	for (const file of files) {
		const reason = exclusionReason(file);
		if (reason) {
			result.excluded.push({ path: file.path, reason });
		} else if (excludes.some((glob) => glob.match(file.path))) {
			result.excluded.push({ path: file.path, reason: 'path filter' });
		} else if (includes.length > 0) {
			if (includes.some((glob) => glob.match(file.path))) result.included.push(file);
			else result.excluded.push({ path: file.path, reason: 'not in path filters' });
		} else if (defaults.some((glob) => glob.match(file.path))) {
			result.excluded.push({ path: file.path, reason: 'ignored by default' });
		} else {
			result.included.push(file);
		}
	}
	return result;

	function exclusionReason(file: FileDiff) {
		if (file.status === 'deleted') return 'deleted';
		if (file.binary) return 'binary';
		if (file.hunks.length === 0) return 'no content changes';
		return null;
	}
}
