import type { Severity } from '@hans/config';
import type { Finding } from './findings';

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
	posted: number;
	dropped: number;
	reviewedFiles: number;
	detailsUrl?: string;
}): string {
	const stats =
		input.posted === 0
			? `No issues found in ${input.reviewedFiles} reviewed file${input.reviewedFiles === 1 ? '' : 's'}.`
			: `${input.posted} comment${input.posted === 1 ? '' : 's'} on ${input.reviewedFiles} reviewed file${input.reviewedFiles === 1 ? '' : 's'}.`;
	const filtered = input.dropped
		? ` ${input.dropped} lower-confidence finding${input.dropped === 1 ? ' was' : 's were'} filtered out.`
		: '';
	const details = input.detailsUrl ? `\n\n[Review details](${input.detailsUrl})` : '';
	return `### hans review\n\n${input.summary}\n\n${stats}${filtered}${details}`;
}
