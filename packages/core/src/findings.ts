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
			'Exact replacement code for lines startLine..endLine, without code fences. Omit unless the fix is small and certain.'
		)
});

export type Finding = z.infer<typeof findingSchema>;

export interface DroppedFinding extends Finding {
	dropReason: string;
}

export function compareSeverity(a: { severity: Severity }, b: { severity: Severity }) {
	return severities.indexOf(b.severity) - severities.indexOf(a.severity);
}
