export interface ExpectedFinding {
	path: string;
	/** Lines (in the head version) where a correct comment may land. */
	lines: [start: number, end: number];
	/** What the bug is, for humans reading the report. */
	description: string;
}

export interface EvalCase {
	name: string;
	description: string;
	/** Repository contents at the base commit. */
	base: Record<string, string>;
	/** Files changed by the pull request (full new content; `null` deletes the file). */
	head: Record<string, string | null>;
	pullRequest: { title: string; body?: string };
	/** Real problems the review should find. Empty for clean changes: every comment is noise. */
	expected: ExpectedFinding[];
}
