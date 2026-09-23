import { severities, type Severity } from '@hans/config';
import { z } from 'zod';

export const categories = [
	'bug',
	'security',
	'performance',
	'concurrency',
	'error-handling',
	'maintainability',
	'testing',
	'documentation'
] as const;

export const findingSchema = z.object({
	path: z.string().describe('File path exactly as shown in the diff header'),
	startLine: z.number().int().positive().describe('First new-file line the finding refers to'),
	endLine: z
		.number()
		.int()
		.positive()
		.describe('Last new-file line; must be in the same diff hunk as startLine'),
	severity: z.enum(severities),
	category: z.enum(categories),
	title: z.string().describe('One-line summary, under 80 characters'),
	body: z
		.string()
		.describe('Why this is a problem and what happens at runtime. Markdown, no headings.'),
	suggestion: z
		.string()
		.optional()
		.describe(
			'Code only, never prose. GitHub replaces lines startLine..endLine verbatim with this text when the author clicks "Apply", so it must be the complete, correctly indented replacement for exactly those lines and keep the code compiling (every block it opens must close). No code fences, no comments explaining the fix. Omit unless the fix is small, local, and certain; explain larger fixes in the body instead.'
		)
});

export type Finding = z.infer<typeof findingSchema>;

export interface DroppedFinding extends Finding {
	dropReason: string;
}

export function compareSeverity(a: { severity: Severity }, b: { severity: Severity }) {
	return severities.indexOf(b.severity) - severities.indexOf(a.severity);
}

/** A finding posted by an earlier review of the same pull request. */
export interface PreviousFinding {
	path: string;
	startLine: number;
	endLine: number;
	category: string;
	title: string;
}

function words(text: string) {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((word) => word.length >= 3)
	);
}

/** Jaccard similarity of the words in two titles. */
export function titleSimilarity(a: string, b: string): number {
	const left = words(a);
	const right = words(b);
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const word of left) if (right.has(word)) shared++;
	return shared / (left.size + right.size - shared);
}

/**
 * Whether a finding repeats one already posted on this PR: same file, and either a similar title
 * on nearby lines (code shifts a little between pushes) or the same category on the same lines.
 * Proximity alone is not enough: a new bug can sit right next to an old one.
 */
export function isDuplicateFinding(
	finding: Finding,
	previous: PreviousFinding[],
	lineTolerance = 3
): boolean {
	return previous.some((prior) => {
		if (prior.path !== finding.path) return false;
		const nearby =
			finding.startLine <= prior.endLine + lineTolerance &&
			finding.endLine >= prior.startLine - lineTolerance;
		const sameLines = finding.startLine === prior.startLine && finding.endLine === prior.endLine;
		return (
			(nearby && titleSimilarity(prior.title, finding.title) >= 0.4) ||
			(sameLines && prior.category === finding.category)
		);
	});
}
