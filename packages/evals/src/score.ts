import type { ExpectedFinding } from './types';

export interface ReportedFinding {
	path: string;
	startLine: number;
	endLine: number;
	title: string;
}

export interface CaseScore {
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	/** Expected findings the review missed. */
	missed: ExpectedFinding[];
	/** Posted findings that match nothing expected. */
	noise: ReportedFinding[];
}

/** Comments may land a little off the exact lines and still point at the same problem. */
const LINE_TOLERANCE = 2;

function overlaps(finding: ReportedFinding, expected: ExpectedFinding) {
	const [start, end] = expected.lines;
	return (
		finding.path === expected.path &&
		finding.startLine <= end + LINE_TOLERANCE &&
		finding.endLine >= start - LINE_TOLERANCE
	);
}

/**
 * Matches posted findings to expected ones. Each expected finding is credited at most once;
 * extra comments on an already-found bug count as noise, since the author reads all of them.
 */
export function scoreCase(expected: ExpectedFinding[], reported: ReportedFinding[]): CaseScore {
	const found = new Set<number>();
	const noise: ReportedFinding[] = [];
	for (const finding of reported) {
		const index = expected.findIndex((e, i) => !found.has(i) && overlaps(finding, e));
		if (index === -1) noise.push(finding);
		else found.add(index);
	}
	return {
		truePositives: found.size,
		falsePositives: noise.length,
		falseNegatives: expected.length - found.size,
		missed: expected.filter((_, i) => !found.has(i)),
		noise
	};
}

export interface Summary {
	precision: number;
	recall: number;
	f1: number;
}

export function summarize(scores: CaseScore[]): Summary {
	const tp = scores.reduce((sum, s) => sum + s.truePositives, 0);
	const fp = scores.reduce((sum, s) => sum + s.falsePositives, 0);
	const fn = scores.reduce((sum, s) => sum + s.falseNegatives, 0);
	// No comments at all on a set of clean changes is perfect precision, not undefined.
	const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
	const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
	const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
	return { precision, recall, f1 };
}
