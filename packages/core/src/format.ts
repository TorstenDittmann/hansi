import type { Severity } from '@hans/config';
import type { Finding } from './findings';
import { tierMeaning, type Tier } from './tier';

const severityLabel: Record<Severity, string> = {
	critical: '🔴 Critical',
	major: '🟠 Major',
	minor: '🟡 Minor',
	info: '🔵 Info'
};

export function formatFindingComment(finding: Finding): string {
	const parts = [
		`**${severityLabel[finding.severity]} · ${finding.category}** — ${finding.title}`,
		finding.body
	];
	if (finding.suggestion !== undefined) {
		parts.push('```suggestion\n' + finding.suggestion.replace(/\n$/, '') + '\n```');
	}
	return parts.join('\n\n');
}

export function formatReviewBody(input: {
	summary: string;
	tier: Tier;
	tierReason: string;
	posted: number;
	dropped: number;
	/** Earlier findings the new code fixed. */
	resolved?: number;
	/** Earlier blocking findings still unresolved. */
	stillOpen?: number;
	reviewedFiles: number;
	incrementalFrom?: string;
	detailsUrl?: string;
}): string {
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const reason = input.tierReason ? ` ${input.tierReason}` : '';
	const lines = [
		`### hans review · Tier ${input.tier}`,
		`**${tierMeaning[input.tier]}.**${reason}`,
		input.summary
	];

	const stats = [
		input.posted === 0
			? `No new issues in ${plural(input.reviewedFiles, 'reviewed file')}.`
			: `${plural(input.posted, 'comment')} on ${plural(input.reviewedFiles, 'reviewed file')}.`
	];
	if (input.resolved) stats.push(`${plural(input.resolved, 'earlier finding')} fixed.`);
	if (input.stillOpen)
		stats.push(`${plural(input.stillOpen, 'earlier blocking finding')} still open.`);
	if (input.dropped) {
		stats.push(`${plural(input.dropped, 'finding')} filtered out.`);
	}
	lines.push(stats.join(' '));

	if (input.incrementalFrom) {
		lines.push(`_Reviewed the commits pushed since \`${input.incrementalFrom.slice(0, 7)}\`._`);
	}
	if (input.detailsUrl) lines.push(`[Review details](${input.detailsUrl})`);
	return lines.join('\n\n');
}
