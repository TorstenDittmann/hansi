import type { Severity, Tier, Verdict } from '@hans/config';
import type { DroppedFinding, Finding } from './findings';
import { tierMeaning } from './tier';

/** Hidden marker that identifies Hansi's summary comment, so each review edits it in place. */
export const SUMMARY_MARKER = '<!-- hans:summary -->';

/**
 * Hidden marker on the summary note that the pull request head moved during the review.
 * Settlement rebuilds the comment from its body, and this keeps the note distinct from a
 * withheld-approval note.
 */
export const STALE_HEAD_NOTE_MARK = '<!-- hans:stale-head -->';

const severityIcon: Record<Severity, string> = {
	critical: '🔴',
	major: '🟠',
	minor: '🟡',
	info: '🔵'
};

const severityName: Record<Severity, string> = {
	critical: 'Critical',
	major: 'Major',
	minor: 'Minor',
	info: 'Info'
};

const tierIcon: Record<Tier, string> = {
	S: '🟢',
	A: '🔵',
	B: '🟡',
	C: '🟠',
	D: '🔴',
	F: '⛔'
};

const verdictText: Record<Verdict, string> = {
	approve: '✅ Approved',
	request_changes: '🛑 Changes requested',
	comment: '💬 Commented'
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Makes text safe inside a Markdown table cell. */
function cell(text: string) {
	return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/**
 * The instruction Greptile-style agents already follow. Kept verbatim so a copied prompt is
 * enough to fix the finding without any Hansi-specific skill.
 */
const agentFixInstruction =
	'For each issue above, determine whether it is valid and should be fixed. If so, fix it directly.';

/** `34` for one line, `143-145` for a range. */
function lineRef(start: number, end = start) {
	return end === start ? `${start}` : `${start}-${end}`;
}

/** A markdown fence long enough that backticks inside `content` cannot close it. */
function fencedMarkdown(content: string) {
	const runs = content.match(/`+/g);
	const longest = runs ? Math.max(...runs.map((run) => run.length)) : 0;
	const fence = '`'.repeat(Math.max(5, longest + 1));
	return `${fence}markdown\n${content.replace(/\n$/, '')}\n${fence}`;
}

/** A collapsed block an agent can copy and follow. */
function agentPromptBlock(summary: string, prompt: string) {
	return `<details><summary>${summary}</summary>\n\n${fencedMarkdown(prompt)}\n\n</details>`;
}

function suggestionFence(suggestion: string) {
	return '```suggestion\n' + suggestion.replace(/\n$/, '') + '\n```';
}

/** Title, explanation, and the GitHub suggestion, in the order a reader sees them. */
function findingText(finding: Pick<Finding, 'title' | 'body' | 'suggestion'>): string {
	const parts = [`**${finding.title}**`];
	if (finding.body) parts.push(finding.body);
	if (finding.suggestion !== undefined) parts.push(suggestionFence(finding.suggestion));
	return parts.join('\n\n');
}

/** One finding, as a self-contained prompt for an agent that only sees this comment. */
function inlineAgentPrompt(finding: Finding): string {
	return [
		'This is a comment left during a code review.',
		`Path: ${finding.path}`,
		`Line: ${lineRef(finding.startLine, finding.endLine)}`,
		'',
		'Comment:',
		findingText(finding),
		'',
		'---',
		'',
		agentFixInstruction
	].join('\n');
}

interface AgentIssue {
	path: string;
	startLine: number;
	endLine?: number;
	title: string;
	body?: string;
	suggestion?: string;
}

/** Every open finding, as one prompt an agent can use to fix the pull request. */
function summaryAgentPrompt(issues: AgentIssue[]): string {
	const blocks = issues.map((issue, index) => {
		const lines = [
			`### Issue ${index + 1}`,
			`${issue.path}:${lineRef(issue.startLine, issue.endLine ?? issue.startLine)}`,
			`**${issue.title}**`
		];
		if (issue.body) lines.push('', issue.body);
		if (issue.suggestion !== undefined) lines.push('', suggestionFence(issue.suggestion));
		return lines.join('\n');
	});
	return [...blocks, `---\n\n${agentFixInstruction}`].join('\n\n');
}

/** An inline review comment: title, explanation, optional suggestion, an agent prompt, then metadata. */
export function formatFindingComment(finding: Finding): string {
	return [
		findingText(finding),
		agentPromptBlock('Prompt To Fix With AI', inlineAgentPrompt(finding)),
		`<sub>${severityIcon[finding.severity]} ${severityName[finding.severity]} · ${finding.category} · Reply if this doesn't apply.</sub>`
	].join('\n\n');
}

export interface SummaryInput {
	repository: string;
	headSha: string;
	summary: string;
	tier: Tier;
	tierReason: string;
	verdict: Verdict;
	posted: Finding[];
	/** Earlier findings the new commits fixed. */
	resolved: { path: string; startLine: number; title: string }[];
	/** Earlier findings that are still open. Body, end line, and suggestion are included when known. */
	stillOpen: {
		path: string;
		startLine: number;
		endLine?: number;
		title: string;
		body?: string;
		suggestion?: string | null;
		severity: Severity;
	}[];
	dropped: DroppedFinding[];
	walkthrough: { path: string; change: string }[];
	/** Incremental reviews: what the newest commits changed. */
	latestChanges?: string | null;
	/** Why Hansi did not approve although nothing is blocking. */
	approvalWithheld?: string | null;
	/**
	 * Set when the head moved after this review started. Newer commits exist and will be
	 * reviewed; this review did not approve the commit it read.
	 */
	staleHead?: string | null;
	incrementalFrom?: string;
	detailsUrl?: string;
	/** The bot's handle, e.g. `@hansi-codes`. */
	mention: string;
}

/** The summary comment Hansi keeps up to date on every pull request. */
export function formatSummaryComment(input: SummaryInput): string {
	const lineLink = (path: string, start: number, end = start) =>
		`[\`${path}:${start}\`](https://github.com/${input.repository}/blob/${input.headSha}/${path}#L${start}${end > start ? `-L${end}` : ''})`;

	const parts = [
		SUMMARY_MARKER,
		`## ${tierIcon[input.tier]} Tier ${input.tier} · ${tierMeaning[input.tier]}`
	];
	if (input.tierReason) parts.push(`> ${cell(input.tierReason)}`);
	parts.push(input.summary);
	if (input.latestChanges) parts.push(`**Latest changes:** ${input.latestChanges}`);

	parts.push(
		[
			'| Verdict | New comments | Fixed | Still open |',
			'| :-- | :-: | :-: | :-: |',
			`| ${verdictText[input.verdict]} | ${input.posted.length} | ${input.resolved.length} | ${input.stillOpen.length} |`
		].join('\n')
	);

	if (input.staleHead) {
		parts.push(`> [!NOTE]\n> ${STALE_HEAD_NOTE_MARK} ${cell(input.staleHead)}`);
	}
	if (input.approvalWithheld) parts.push(`> [!NOTE]\n> ${cell(input.approvalWithheld)}`);

	if (input.posted.length) {
		parts.push(
			[
				'| | Finding | Where |',
				'| :-: | :-- | :-- |',
				...input.posted.map(
					(f) =>
						`| ${severityIcon[f.severity]} | ${cell(f.title)} | ${lineLink(f.path, f.startLine, f.endLine)} |`
				)
			].join('\n')
		);
	}

	const openIssues: AgentIssue[] = [
		...input.posted,
		...input.stillOpen.map((finding) => ({
			path: finding.path,
			startLine: finding.startLine,
			endLine: finding.endLine,
			title: finding.title,
			body: finding.body,
			...(finding.suggestion ? { suggestion: finding.suggestion } : {})
		}))
	];
	if (openIssues.length) {
		parts.push(agentPromptBlock('Fix with agent prompt', summaryAgentPrompt(openIssues)));
	}

	const section = (title: string, count: number, body: string) =>
		`<details>\n<summary><b>${title}</b> · ${count}</summary>\n\n${body}\n\n</details>`;

	if (input.walkthrough.length) {
		parts.push(
			section(
				'📂 Walkthrough',
				input.walkthrough.length,
				[
					'| File | Change |',
					'| :-- | :-- |',
					...input.walkthrough.map((w) => `| \`${cell(w.path)}\` | ${cell(w.change)} |`)
				].join('\n')
			)
		);
	}
	if (input.stillOpen.length) {
		parts.push(
			section(
				'⏳ Still open from earlier reviews',
				input.stillOpen.length,
				input.stillOpen
					.map((f) => `- ${severityIcon[f.severity]} ${f.title} · ${lineLink(f.path, f.startLine)}`)
					.join('\n')
			)
		);
	}
	if (input.resolved.length) {
		parts.push(
			section(
				'✅ Fixed since the last review',
				input.resolved.length,
				input.resolved.map((f) => `- ~~${f.title}~~ · \`${f.path}:${f.startLine}\``).join('\n')
			)
		);
	}
	if (input.dropped.length) {
		parts.push(
			section(
				'🔇 Filtered out',
				input.dropped.length,
				[
					'Findings Hansi considered but did not post.',
					'',
					'| Finding | Why |',
					'| :-- | :-- |',
					...input.dropped.map((f) => `| ${cell(f.title)} | ${cell(f.dropReason)} |`)
				].join('\n')
			)
		);
	}

	const scope = input.incrementalFrom
		? `the commits since <code>${input.incrementalFrom.slice(0, 7)}</code>`
		: `<code>${input.headSha.slice(0, 7)}</code>`;
	const details = input.detailsUrl ? ` · <a href="${input.detailsUrl}">Details</a>` : '';
	parts.push(
		`---\n<sub>Reviewed ${scope}${details} · Comment <code>${input.mention} review</code> to re-run, or mention <code>${input.mention}</code> with a question.</sub>`
	);
	return parts.join('\n\n');
}

/** The body of the GitHub review itself; the summary comment carries the details. */
export function formatReviewBody(input: {
	tier: Tier;
	verdict: Verdict;
	blocking: number;
	/** Inline comments on this review. A Tier S review with none still says it is ready. */
	comments?: number;
	summaryUrl?: string;
}): string {
	const link = input.summaryUrl ? ` [Summary](${input.summaryUrl})` : '';
	const readyWithoutComments = input.tier === 'S' && input.comments === 0;
	const headline =
		input.verdict === 'request_changes'
			? `${plural(input.blocking, 'blocking finding')} to address.`
			: input.verdict === 'approve' || readyWithoutComments
				? 'Looks good to merge.'
				: 'See the inline comments.';
	return `${tierIcon[input.tier]} **Tier ${input.tier}** · ${headline}${link}`;
}
