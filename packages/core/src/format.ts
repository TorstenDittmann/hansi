import type { Severity, Tier, Verdict } from '@hans/config';
import type { DroppedFinding, Finding } from './findings';
import { tierMeaning } from './tier';

/** Hidden marker that identifies hans's summary comment, so each review edits it in place. */
export const SUMMARY_MARKER = '<!-- hans:summary -->';

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

/** An inline review comment: title first, the explanation, an optional suggestion, then metadata. */
export function formatFindingComment(finding: Finding): string {
	const parts = [`**${finding.title}**`, finding.body];
	if (finding.suggestion !== undefined) {
		parts.push('```suggestion\n' + finding.suggestion.replace(/\n$/, '') + '\n```');
	}
	parts.push(
		`<sub>${severityIcon[finding.severity]} ${severityName[finding.severity]} · ${finding.category} · Reply if this doesn't apply.</sub>`
	);
	return parts.join('\n\n');
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
	/** Earlier blocking findings that are still open. */
	stillOpen: { path: string; startLine: number; title: string; severity: Severity }[];
	dropped: DroppedFinding[];
	walkthrough: { path: string; change: string }[];
	incrementalFrom?: string;
	detailsUrl?: string;
	/** The bot's handle, e.g. `@hans-review`. */
	mention: string;
}

/** The summary comment hans keeps up to date on every pull request. */
export function formatSummaryComment(input: SummaryInput): string {
	const lineLink = (path: string, start: number, end = start) =>
		`[\`${path}:${start}\`](https://github.com/${input.repository}/blob/${input.headSha}/${path}#L${start}${end > start ? `-L${end}` : ''})`;

	const parts = [
		SUMMARY_MARKER,
		`## ${tierIcon[input.tier]} Tier ${input.tier} · ${tierMeaning[input.tier]}`
	];
	if (input.tierReason) parts.push(`> ${cell(input.tierReason)}`);
	parts.push(input.summary);

	parts.push(
		[
			'| Verdict | New comments | Fixed | Still open |',
			'| :-- | :-: | :-: | :-: |',
			`| ${verdictText[input.verdict]} | ${input.posted.length} | ${input.resolved.length} | ${input.stillOpen.length} |`
		].join('\n')
	);

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
					'Findings hans considered but did not post.',
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
	summaryUrl?: string;
}): string {
	const link = input.summaryUrl ? ` [Summary](${input.summaryUrl})` : '';
	const headline =
		input.verdict === 'request_changes'
			? `${plural(input.blocking, 'blocking finding')} to address.`
			: input.verdict === 'approve'
				? 'Looks good to merge.'
				: 'See the inline comments.';
	return `${tierIcon[input.tier]} **Tier ${input.tier}** · ${headline}${link}`;
}
