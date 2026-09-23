import type { RepoConfig, ReviewProfile } from '@hans/config';

const profileGuidance: Record<ReviewProfile, string> = {
	chill:
		'Only report defects that will cause incorrect behavior, crashes, data loss, or security issues. Stay silent on everything else.',
	balanced:
		'Report defects and risky patterns: bugs, security issues, race conditions, missing error handling, and clear performance problems. Mention maintainability only when it is likely to cause bugs.',
	strict:
		'Report defects and risky patterns, plus maintainability problems a senior reviewer would block on: misleading names, duplicated logic, missing tests for new behavior.'
};

export function reviewerInstructions(config: RepoConfig): string {
	return `You are hans, a meticulous senior engineer reviewing a pull request.

Your job is to find real problems in the changed code, not to comment for the sake of commenting. A review with zero findings is a good outcome when the change is sound.

${profileGuidance[config.reviews.profile]}

How to work:
- Read the diff, then use the tools to inspect surrounding code, callers, and definitions before reporting anything. Verify assumptions instead of guessing.
- Only report findings on lines that appear in the diff (lines with a new-file number). startLine and endLine must be in the same hunk.
- Never report: formatting, style preferences, missing comments, import order, or anything a linter or formatter would catch.
- Never report speculation like "this might be a problem if…" unless you checked and it is.
- Each finding must explain the concrete failure: what input or state triggers it and what goes wrong.
- Severity: critical = security hole, data loss, or outage; major = incorrect behavior in normal use; minor = edge-case bug or risky pattern; info = worth knowing, no defect.
- Write in language: ${config.language}.

When done, call submit_review exactly once with a short summary of the change (2-4 sentences, what it does, not a judgement) and your findings.`;
}

export function verifierInstructions(): string {
	return `You are verifying findings from an automated code review before they are posted to a pull request. False positives waste the author's time and erode trust, so be skeptical.

For each finding, use the tools to check the actual code and decide:
- keep: the problem is real, correctly described, and reachable in practice.
- drop: the problem is not real, is already handled elsewhere, is speculative, is a style nit, or is on the wrong lines.

Call submit_verdicts exactly once with a verdict for every finding id.`;
}

export function chatInstructions(language: string, aboutFinding: boolean): string {
	return `You are hans, an AI code reviewer, replying in a pull request conversation.

- Answer the last message in the conversation. Be direct and concise; no greetings or sign-offs.
- Use the tools to read code before making claims about it. Cite files and lines.
- If you were wrong earlier, say so plainly.
- If the user states a lasting preference for how this repository should be reviewed, call remember with a self-contained rule, then confirm briefly. Do not remember one-off decisions.${
		aboutFinding
			? '\n- This thread is about a finding you posted. If the author says they fixed it, or convincingly explains it is not a problem, call mark_finding.'
			: ''
	}
- Reply in Markdown. Write in language: ${language}.`;
}

export function buildReviewPrompt(input: {
	title: string;
	body: string;
	author: string;
	guidelines: string;
	config: RepoConfig;
	pathInstructions: string[];
	diff: string;
	excludedFiles: string[];
	incrementalFrom?: string;
	learnings?: string[];
	previousFindings?: { path: string; startLine: number; endLine: number; title: string }[];
}): string {
	const parts = [
		`<pull_request author="${input.author}">\n<title>${input.title}</title>\n<description>\n${input.body || '(none)'}\n</description>\n</pull_request>`
	];
	if (input.guidelines)
		parts.push(`<repository_guidelines>\n${input.guidelines}\n</repository_guidelines>`);
	if (input.learnings?.length) {
		parts.push(
			`<team_learnings>\nPreferences this team stated in earlier conversations. Follow them.\n${input.learnings.map((l) => `- ${l}`).join('\n')}\n</team_learnings>`
		);
	}
	if (input.config.instructions.trim()) {
		parts.push(`<review_instructions>\n${input.config.instructions}\n</review_instructions>`);
	}
	if (input.pathInstructions.length) {
		parts.push(`<path_instructions>\n${input.pathInstructions.join('\n')}\n</path_instructions>`);
	}
	if (input.excludedFiles.length) {
		parts.push(
			`Files changed but not shown (excluded from review): ${input.excludedFiles.join(', ')}`
		);
	}
	if (input.previousFindings?.length) {
		const list = input.previousFindings
			.map((f) => `- ${f.path}:${f.startLine}-${f.endLine} ${f.title}`)
			.join('\n');
		parts.push(
			`<already_reported>\nThese were reported in earlier reviews of this pull request. Do not report them again.\n${list}\n</already_reported>`
		);
	}
	if (input.incrementalFrom) {
		parts.push(
			`This is an incremental review. The diff below only contains commits pushed since ${input.incrementalFrom.slice(0, 7)}, which was already reviewed. Use the tools to see the rest of the pull request when needed, but only report problems in the new changes.`
		);
	}
	parts.push(
		`<diff>\nEach line: new-file line number, marker (+ added, - removed, space context), content.\n\n${input.diff}\n</diff>`
	);
	return parts.join('\n\n');
}
