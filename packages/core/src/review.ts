import { readFile } from 'node:fs/promises';
import { blockingSeverity, severityAtLeast, type RepoConfig, type Severity } from '@hans/config';
import { generateText, hasToolCall, isStepCount, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import {
	commentableLines,
	hunkIndexOf,
	parseUnifiedDiff,
	renderFileDiff,
	type FileDiff
} from './diff';
import { filterFiles } from './filters';
import { callModel, type ModelCall, type ModelFailure } from './model-call';
import {
	compareSeverity,
	findingSchema,
	isDuplicateFinding,
	type DroppedFinding,
	type Finding,
	type PreviousFinding
} from './findings';
import { buildReviewPrompt, reviewerInstructions, verifierInstructions } from './prompts';
import { finalTier, tierCap, tiers, type Tier } from './tier';
import { checkSuggestion } from './suggestions';
import { decideVerdict, type Verdict } from './verdict';
import {
	createRepoTools,
	loadRepoGuidelines,
	resolveRepoPath,
	type EmitEvent,
	type TrustedSource
} from './tools';

export interface ReviewModel {
	model: LanguageModel;
	provider: string;
	modelId: string;
}

export interface ReviewInput {
	/** Checkout of the PR head. */
	repoDir: string;
	/** Diff to review: the whole PR, or only the commits since the last review. */
	diff: string;
	/** Full PR diff (merge base → head); comments must land on it. Defaults to `diff`. */
	pullRequestDiff?: string;
	/** Set when `diff` only covers commits since this previously reviewed SHA. */
	incrementalFrom?: string;
	/** Findings already posted on this PR, so they are not repeated. */
	previousFindings?: PreviousFinding[];
	/**
	 * Posted findings not yet resolved or dismissed. The model checks whether the current code
	 * fixes them; open blocking findings keep a PR from being approved.
	 */
	openFindings?: OpenFinding[];
	/** Team preferences from earlier conversations (see `remember` in chat). */
	learnings?: string[];
	/** Where to read repository guidelines from; defaults to the (untrusted) PR checkout. */
	trustedSource?: TrustedSource;
	/** When set, Hansi may not approve, for this reason (e.g. an outside contributor). */
	withholdApproval?: string;
	/**
	 * Summary and walkthrough from the last review. Incremental reviews update them so the
	 * summary keeps describing the whole pull request, not just the newest commits.
	 */
	previousSummary?: { summary: string; walkthrough: WalkthroughEntry[] };
	pullRequest: { title: string; body: string; author: string };
	config: RepoConfig;
	models: { review: ReviewModel; verify?: ReviewModel };
	onEvent?: EmitEvent;
	onModelCall?: (call: ModelCall) => void | Promise<void>;
	onModelError?: (failure: ModelFailure) => void | Promise<void>;
	signal?: AbortSignal;
	limits?: { maxDiffChars?: number; maxReviewSteps?: number; maxVerifySteps?: number };
}

export interface WalkthroughEntry {
	path: string;
	change: string;
}

export interface OpenFinding {
	id: string;
	path: string;
	startLine: number;
	endLine: number;
	severity: Severity;
	title: string;
	body: string;
}

export type ReviewResult =
	| { status: 'skipped'; reason: string }
	| {
			status: 'completed';
			summary: string;
			reviewedFiles: string[];
			posted: Finding[];
			dropped: DroppedFinding[];
			/** Ids of open findings the current code fixes. */
			resolved: string[];
			/** Earlier blocking findings that are still unresolved. */
			stillOpenBlocking: number;
			verdict: Verdict;
			/** Merge confidence for the whole PR, S (best) to F. */
			tier: Tier;
			tierReason: string;
			/** What changed, per file, across the whole pull request. */
			walkthrough: WalkthroughEntry[];
			/** Incremental reviews: what the newest commits changed. */
			latestChanges: string | null;
			/** Why Hansi did not approve although it found nothing blocking. */
			approvalWithheld: string | null;
	  };

const submissionSchema = z.object({
	summary: z.string(),
	findings: z.array(findingSchema),
	resolved: z
		.array(z.string())
		.default([])
		.describe('Ids of <open_findings> that the current code fixes'),
	tier: z.enum(tiers).optional().describe('Merge confidence for the whole pull request'),
	walkthrough: z
		.array(z.object({ path: z.string(), change: z.string() }))
		.default([])
		.describe('One short line per changed file (or group of files) describing what changed'),
	latest_changes: z
		.string()
		.optional()
		.describe('Incremental reviews only: one sentence on what the newest commits changed'),
	tier_reason: z.string().optional().describe('One sentence explaining the tier')
});
const verdictsSchema = z.object({
	verdicts: z.array(
		z.object({
			id: z.string(),
			keep: z.boolean(),
			reason: z.string(),
			suggestion_ok: z
				.boolean()
				.optional()
				.describe('For findings with a suggestion: is applying it correct?'),
			start_line: z
				.number()
				.int()
				.optional()
				.describe('Only when the finding points at the wrong lines: the correct first line'),
			end_line: z
				.number()
				.int()
				.optional()
				.describe('Only when the finding points at the wrong lines: the correct last line')
		})
	)
});

const DEFAULT_LIMITS = { maxDiffChars: 150_000, maxReviewSteps: 40, maxVerifySteps: 20 };

export async function runReview(input: ReviewInput): Promise<ReviewResult> {
	const limits = { ...DEFAULT_LIMITS, ...input.limits };
	const emit: EmitEvent = input.onEvent ?? (() => {});
	const { config } = input;

	const { included, excluded } = filterFiles(
		parseUnifiedDiff(input.diff),
		config.reviews.pathFilters
	);
	emit({ type: 'files.filtered', data: { included: included.map((f) => f.path), excluded } });
	if (included.length === 0) {
		const reason = input.incrementalFrom
			? 'No new reviewable changes since the last review'
			: 'No reviewable changes';
		return { status: 'skipped', reason };
	}
	const pullRequestFiles = input.pullRequestDiff ? parseUnifiedDiff(input.pullRequestDiff) : null;
	const previousFindings = input.previousFindings ?? [];

	// Keep the prompt within budget; files that don't fit are listed but not shown.
	const shown: FileDiff[] = [];
	const excludedPaths = excluded.map((e) => e.path);
	let budget = limits.maxDiffChars;
	for (const file of included) {
		const rendered = renderFileDiff(file);
		if (rendered.length > budget) {
			excludedPaths.push(file.path);
			continue;
		}
		budget -= rendered.length;
		shown.push(file);
	}
	if (shown.length === 0) return { status: 'skipped', reason: 'Diff too large to review' };

	const pathInstructions = config.pathInstructions.flatMap((entry) => {
		const glob = new Bun.Glob(entry.path);
		return shown.some((file) => glob.match(file.path))
			? [`For files matching ${entry.path}: ${entry.instructions}`]
			: [];
	});

	const tools = createRepoTools(input.repoDir, emit);
	const prompt = buildReviewPrompt({
		...input.pullRequest,
		guidelines: await loadRepoGuidelines(input.repoDir, input.trustedSource),
		config,
		pathInstructions,
		diff: shown.map(renderFileDiff).join('\n\n'),
		excludedFiles: excludedPaths,
		incrementalFrom: input.incrementalFrom,
		learnings: input.learnings,
		previousFindings,
		openFindings: input.openFindings,
		previousSummary: input.incrementalFrom ? input.previousSummary : undefined,
		pullRequestFiles: input.incrementalFrom
			? (pullRequestFiles ?? []).map((f) => f.path)
			: undefined
	});

	// 1. Review: an agent loop that explores the repo, then submits findings.
	const submitReview = tool({
		description: 'Submit the review. Call exactly once, at the end.',
		inputSchema: submissionSchema,
		execute: async () => 'Review submitted.'
	});
	const review = await callModel('review', input.models.review, input, () =>
		generateText({
			model: input.models.review.model,
			instructions: reviewerInstructions(config),
			prompt,
			tools: { ...tools, submit_review: submitReview },
			stopWhen: [isStepCount(limits.maxReviewSteps), hasToolCall('submit_review')],
			abortSignal: input.signal
		})
	);
	const submission = review.toolCalls.findLast((call) => call.toolName === 'submit_review');
	if (!submission) {
		throw new Error(
			'The review model did not submit a review. Check that it supports tool calling.'
		);
	}
	const submitted = submissionSchema.parse(submission.input);
	const { summary, findings } = submitted;
	const openFindings = input.openFindings ?? [];
	const resolved = submitted.resolved.filter((id) => openFindings.some((f) => f.id === id));
	emit({
		type: 'review.submitted',
		data: { findings: findings.length, resolved, tier: submitted.tier ?? null }
	});

	// 2. Validate positions: GitHub rejects comments outside the PR diff. For incremental reviews
	//    the finding must be on a newly changed line *and* on a line of the full PR diff.
	const dropped: DroppedFinding[] = [];
	const place = (finding: Finding) => {
		const placed = placeFinding(finding, shown);
		return placed && pullRequestFiles ? placeFinding(placed, pullRequestFiles) : placed;
	};
	const positioned = findings.flatMap((finding) => {
		const placed = place(finding);
		if (!placed) {
			dropped.push({ ...finding, dropReason: 'Not on a changed line' });
			return [];
		}
		if (isDuplicateFinding(placed, previousFindings)) {
			dropped.push({ ...placed, dropReason: 'Already reported in an earlier review' });
			return [];
		}
		return [placed];
	});

	// 3. Severity threshold from `.hansi.json`.
	const relevant = positioned.filter((finding) => {
		const keep = severityAtLeast(finding.severity, config.reviews.minSeverity);
		if (!keep)
			dropped.push({
				...finding,
				dropReason: `Below minSeverity (${config.reviews.minSeverity})`
			});
		return keep;
	});

	// 4. Verify: a second, skeptical pass removes false positives.
	const verified = relevant.length
		? await verifyFindings(relevant, input, tools, limits.maxVerifySteps, dropped, place)
		: [];

	// 5. Cap the number of comments, most severe first.
	verified.sort(compareSeverity);
	const capped = verified.slice(0, config.reviews.maxComments);

	// 6. A suggestion is applied verbatim with one click: never post one that breaks the code.
	const posted = await Promise.all(
		capped.map(async (finding) => {
			const check = await checkSuggestion(input.repoDir, finding);
			if (check.ok) return finding;
			emit({
				type: 'suggestion.removed',
				data: { path: finding.path, title: finding.title, reason: check.reason }
			});
			return withoutSuggestion(finding);
		})
	);
	for (const finding of verified.slice(config.reviews.maxComments)) {
		dropped.push({ ...finding, dropReason: `Over maxComments (${config.reviews.maxComments})` });
	}

	// 7. Verdict and tier reflect the whole PR: new findings plus earlier ones still open.
	const stillOpen = openFindings.filter((f) => !resolved.includes(f.id));
	const threshold = blockingSeverity(config);
	const stillOpenBlocking = stillOpen.filter((f) => severityAtLeast(f.severity, threshold)).length;
	let verdict = decideVerdict({ posted, stillOpen: stillOpenBlocking, config });
	// Approval is the one outcome an attacker would want: only grant it when it is safe to.
	const truncated = shown.length < included.length;
	const approvalWithheld =
		verdict !== 'approve'
			? null
			: (input.withholdApproval ??
				(truncated ? 'Part of the diff was too large to review, so Hansi did not approve.' : null));
	if (approvalWithheld) verdict = 'comment';
	const open = [...posted, ...stillOpen].sort(compareSeverity);
	// Without a grade from the model, the open findings decide (S when nothing is open).
	const tier = finalTier(submitted.tier, tierCap(open.map((f) => f.severity)));
	const limitedBy = tier !== submitted.tier ? open[0] : undefined;
	const tierReason = limitedBy
		? `Limited by an open ${limitedBy.severity} finding: ${limitedBy.title}`
		: (submitted.tier_reason ?? '');

	emit({
		type: 'review.completed',
		data: {
			posted: posted.length,
			dropped: dropped.length,
			stillOpen: stillOpen.length,
			verdict,
			tier
		}
	});
	return {
		status: 'completed',
		summary,
		reviewedFiles: shown.map((f) => f.path),
		posted,
		dropped,
		resolved,
		stillOpenBlocking,
		verdict,
		tier,
		tierReason,
		walkthrough: mergeWalkthrough(
			submitted.walkthrough,
			input.incrementalFrom ? input.previousSummary?.walkthrough : undefined,
			pullRequestFiles?.map((f) => f.path)
		),
		latestChanges: input.incrementalFrom ? (submitted.latest_changes ?? null) : null,
		approvalWithheld
	};
}

/**
 * The walkthrough from this review, plus entries from the previous one for files the model did
 * not mention again but that are still part of the pull request.
 */
export function mergeWalkthrough(
	current: WalkthroughEntry[],
	previous: WalkthroughEntry[] = [],
	pullRequestPaths?: string[]
): WalkthroughEntry[] {
	const covered = new Set(current.map((entry) => entry.path));
	const carried = previous.filter(
		(entry) =>
			!covered.has(entry.path) && (!pullRequestPaths || pullRequestPaths.includes(entry.path))
	);
	return [...current, ...carried];
}

function withoutSuggestion(finding: Finding): Finding {
	const copy = { ...finding };
	delete copy.suggestion;
	return copy;
}

/**
 * Moves a kept finding to the lines the verifier says it is really about. The original position
 * already passed validation, so it stays when the corrected one is not commentable.
 */
function relocate(
	finding: Finding,
	verdict: { start_line?: number; end_line?: number },
	place: (finding: Finding) => Finding | null,
	emit?: EmitEvent
): Finding {
	const startLine = verdict.start_line ?? verdict.end_line;
	const endLine = verdict.end_line ?? verdict.start_line;
	if (startLine === undefined || endLine === undefined) return finding;
	if (startLine === finding.startLine && endLine === finding.endLine) return finding;
	const placed = place({ ...finding, startLine, endLine });
	if (!placed) return finding;
	emit?.({
		type: 'finding.relocated',
		data: {
			path: finding.path,
			title: finding.title,
			from: [finding.startLine, finding.endLine],
			to: [placed.startLine, placed.endLine]
		}
	});
	// A suggestion replaces exactly the lines it was written for.
	return withoutSuggestion(placed);
}

/** Clamps a finding onto commentable lines of a single hunk, or returns null. */
export function placeFinding(finding: Finding, files: FileDiff[]): Finding | null {
	const file = files.find((f) => f.path === finding.path);
	if (!file) return null;
	const lines = commentableLines(file);
	const endLine = Math.max(finding.startLine, finding.endLine);
	if (!lines.has(endLine)) return null;

	const startLine =
		lines.has(finding.startLine) &&
		hunkIndexOf(file, finding.startLine) === hunkIndexOf(file, endLine)
			? Math.min(finding.startLine, endLine)
			: endLine;
	return { ...finding, startLine, endLine };
}

async function verifyFindings(
	findings: Finding[],
	input: ReviewInput,
	tools: ReturnType<typeof createRepoTools>,
	maxSteps: number,
	dropped: DroppedFinding[],
	place: (finding: Finding) => Finding | null
): Promise<Finding[]> {
	const verifyModel = input.models.verify ?? input.models.review;
	const listing = await Promise.all(
		findings.map(async (finding, i) => {
			const context = await codeContext(
				input.repoDir,
				finding.path,
				finding.startLine,
				finding.endLine
			);
			const suggestion =
				finding.suggestion === undefined
					? ''
					: `\n\n<suggestion replaces_lines="${finding.startLine}-${finding.endLine}">\n${finding.suggestion}\n</suggestion>`;
			return `<finding id="F${i + 1}" path="${finding.path}" lines="${finding.startLine}-${finding.endLine}" severity="${finding.severity}">\n${finding.title}\n\n${finding.body}\n\n<code>\n${context}\n</code>${suggestion}\n</finding>`;
		})
	);

	const submitVerdicts = tool({
		description: 'Submit a verdict for every finding. Call exactly once.',
		inputSchema: verdictsSchema,
		execute: async () => 'Verdicts submitted.'
	});

	const result = await callModel('verify', verifyModel, input, () =>
		generateText({
			model: verifyModel.model,
			instructions: verifierInstructions(input.config.reviews.profile),
			prompt: `Pull request: ${input.pullRequest.title}\n\n${listing.join('\n\n')}`,
			tools: { ...tools, submit_verdicts: submitVerdicts },
			stopWhen: [isStepCount(maxSteps), hasToolCall('submit_verdicts')],
			abortSignal: input.signal
		})
	);

	const call = result.toolCalls.findLast((c) => c.toolName === 'submit_verdicts');
	const verdicts = call ? verdictsSchema.parse(call.input).verdicts : [];
	const byId = new Map(verdicts.map((v) => [v.id, v]));
	input.onEvent?.({ type: 'verify.completed', data: { verdicts } });

	// A finding without a verdict is kept: a flaky verifier must not silently hide real bugs.
	return findings.flatMap((original, i) => {
		const verdict = byId.get(`F${i + 1}`);
		if (verdict && !verdict.keep) {
			dropped.push({ ...original, dropReason: `Verifier: ${verdict.reason}` });
			return [];
		}
		const finding = verdict ? relocate(original, verdict, place, input.onEvent) : original;
		if (verdict?.suggestion_ok === false && finding.suggestion !== undefined) {
			input.onEvent?.({
				type: 'suggestion.removed',
				data: { path: finding.path, title: finding.title, reason: 'verifier rejected it' }
			});
			return [withoutSuggestion(finding)];
		}
		return [finding];
	});
}

async function codeContext(repoDir: string, path: string, start: number, end: number) {
	try {
		const lines = (await readFile(resolveRepoPath(repoDir, path), 'utf8')).split('\n');
		const from = Math.max(start - 10, 1);
		const to = Math.min(end + 10, lines.length);
		return lines
			.slice(from - 1, to)
			.map((line, i) => `${String(from + i).padStart(5)}  ${line}`)
			.join('\n');
	} catch {
		return '(file unavailable)';
	}
}
