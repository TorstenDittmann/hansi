import parseDiff from 'parse-diff';

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffLine {
	type: 'add' | 'del' | 'context';
	/** Line number in the new file; undefined for deletions. */
	newLine?: number;
	content: string;
}

export interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

export interface FileDiff {
	path: string;
	oldPath?: string;
	status: FileStatus;
	additions: number;
	deletions: number;
	binary: boolean;
	hunks: DiffHunk[];
}

/** Parses `git diff` output into per-file hunks with new-side line numbers. */
export function parseUnifiedDiff(diff: string): FileDiff[] {
	return parseDiff(diff).map((file) => {
		const path = file.deleted ? file.from! : file.to!;
		const renamed = !!file.from && !!file.to && file.from !== file.to && !file.new && !file.deleted;
		const status: FileStatus = file.new
			? 'added'
			: file.deleted
				? 'deleted'
				: renamed
					? 'renamed'
					: 'modified';

		const hunks = file.chunks.map((chunk) => ({
			header: chunk.content,
			lines: chunk.changes.map((change): DiffLine => {
				const content = change.content.slice(1);
				if (change.type === 'add') return { type: 'add', newLine: change.ln, content };
				if (change.type === 'del') return { type: 'del', content };
				return { type: 'context', newLine: change.ln2, content };
			})
		}));

		return {
			path,
			oldPath: renamed ? file.from : undefined,
			status,
			additions: file.additions,
			deletions: file.deletions,
			binary: file.chunks.length === 0 && !file.deleted && !file.new && !renamed,
			hunks
		};
	});
}

/** Lines GitHub accepts review comments on (RIGHT side): added and context lines in hunks. */
export function commentableLines(file: FileDiff): Set<number> {
	const lines = new Set<number>();
	for (const hunk of file.hunks) {
		for (const line of hunk.lines) {
			if (line.newLine !== undefined) lines.add(line.newLine);
		}
	}
	return lines;
}

/** Hunk index containing `line`, so multi-line comments never span hunks (GitHub rejects that). */
export function hunkIndexOf(file: FileDiff, line: number): number {
	return file.hunks.findIndex((hunk) => hunk.lines.some((l) => l.newLine === line));
}

/**
 * Renders a file diff for the model with explicit new-side line numbers, so the model can cite
 * lines that map directly onto GitHub's review comment API.
 */
export function renderFileDiff(file: FileDiff): string {
	const header = `### ${file.path}${file.oldPath ? ` (renamed from ${file.oldPath})` : ''} [${file.status}, +${file.additions} -${file.deletions}]`;
	const hunks = file.hunks.map((hunk) => {
		const lines = hunk.lines.map((line) => {
			const number = line.newLine === undefined ? '' : String(line.newLine);
			const marker = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
			return `${number.padStart(5)} ${marker} ${line.content}`;
		});
		return [hunk.header, ...lines].join('\n');
	});
	return [header, ...hunks].join('\n');
}
