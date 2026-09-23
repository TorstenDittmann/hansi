import { readFile } from 'node:fs/promises';
import { severityAtLeast, type RepoConfig } from '@hans/config';
import {
	generateText,
	hasToolCall,
	isStepCount,
	tool,
	type LanguageModel,
	type LanguageModelUsage
} from 'ai';
import { z } from 'zod';
import {
	commentableLines,
	hunkIndexOf,
	parseUnifiedDiff,
	renderFileDiff,
	type FileDiff
} from './diff';
import { filterFiles } from './filters';
import {
	compareSeverity,
	findingSchema,
	isDuplicateFinding,
	type DroppedFinding,
	type Finding,
	type PreviousFinding
} from './findings';
import { buildReviewPrompt, reviewerInstructions, verifierInstructions } from './prompts';
import { createRepoTools, loadRepoGuidelines, resolveRepoPath, type EmitEvent } from './tools';

export interface ReviewModel {
	model: LanguageModel;
	provider: string;
	modelId: string;
}

export interface ModelCall {
	role: 'review' | 'verify';
	provider: string;
	modelId: string;
	usage: LanguageModelUsage;
	durationMs: number;
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
	pullRequest: { title: string; body: string; author: string };
	config: RepoConfig;
	models: { review: ReviewModel; verify?: ReviewModel };
	onEvent?: EmitEvent;
	onModelCall?: (call: ModelCall) => void | Promise<void>;
	signal?: AbortSignal;
	limits?: { maxDiffChars?: number; maxReviewSteps?: number; maxVerifySteps?: number };
}

export type ReviewResult =
	| { status: 'skipped'; reason: string }
	| {
			status: 'completed';
			summary: string;
			reviewedFiles: string[];
			posted: Finding[];
			dropped: DroppedFinding[];
	  };

const submissionSchema = z.object({ summary: z.string(), findings: z.array(findingSchema) });
const verdictsSchema = z.object({
	verdicts: z.array(z.object({ id: z.string(), keep: z.boolean(), reason: z.string() }))
});

const DEFAULT_LIMITS = { maxDiffChars: 150_000, maxReviewSteps: 40, maxVerifySteps: 20 };

export async function runReview(input: ReviewInput): Promise<ReviewResult> {
	const limits = { ...DEFAULT_LIMITS, ...input.limits };
	const emit: EmitEvent = input.onEvent ?? (() => {});
	const { config } = input;

	const { included, excluded } = filterFiles(
		parseUnifiedDiff(input.diff),
		config.reviews.path_filters
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

	const pathInstructions = config.path_instructions.flatMap((entry) => {
		const glob = new Bun.Glob(entry.path);
		return shown.some((file) => glob.match(file.path))
			? [`For files matching ${entry.path}: ${entry.instructions}`]
			: [];
	});

	const tools = createRepoTools(input.repoDir, emit);
	const prompt = buildReviewPrompt({
		...input.pullRequest,
		guidelines: await loadRepoGuidelines(input.repoDir),
		config,
		pathInstructions,
		diff: shown.map(renderFileDiff).join('\n\n'),
		excludedFiles: excludedPaths,
		incrementalFrom: input.incrementalFrom,
		previousFindings
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
	const { summary, findings } = submissionSchema.parse(submission.input);
	emit({ type: 'review.submitted', data: { findings: findings.length } });

	// 2. Validate positions: GitHub rejects comments outside the PR diff. For incremental reviews
	//    the finding must be on a newly changed line *and* on a line of the full PR diff.
	const dropped: DroppedFinding[] = [];
	const positioned = findings.flatMap((finding) => {
		let placed = placeFinding(finding, shown);
		if (placed && pullRequestFiles) placed = placeFinding(placed, pullRequestFiles);
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

	// 3. Severity threshold from `.hans.yml`.
	const relevant = positioned.filter((finding) => {
		const keep = severityAtLeast(finding.severity, config.reviews.min_severity);
		if (!keep)
			dropped.push({
				...finding,
				dropReason: `Below min_severity (${config.reviews.min_severity})`
			});
		return keep;
	});

	// 4. Verify: a second, skeptical pass removes false positives.
	const verified = relevant.length
		? await verifyFindings(relevant, input, tools, limits.maxVerifySteps, dropped)
		: [];

	// 5. Cap the number of comments, most severe first.
	verified.sort(compareSeverity);
	const posted = verified.slice(0, config.reviews.max_comments);
	for (const finding of verified.slice(config.reviews.max_comments)) {
		dropped.push({ ...finding, dropReason: `Over max_comments (${config.reviews.max_comments})` });
	}

	emit({ type: 'review.completed', data: { posted: posted.length, dropped: dropped.length } });
	return { status: 'completed', summary, reviewedFiles: shown.map((f) => f.path), posted, dropped };
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
	dropped: DroppedFinding[]
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
			return `<finding id="F${i + 1}" path="${finding.path}" lines="${finding.startLine}-${finding.endLine}" severity="${finding.severity}">\n${finding.title}\n\n${finding.body}\n\n<code>\n${context}\n</code>\n</finding>`;
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
			instructions: verifierInstructions(),
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
	return findings.filter((finding, i) => {
		const verdict = byId.get(`F${i + 1}`);
		if (verdict && !verdict.keep)
			dropped.push({ ...finding, dropReason: `Verifier: ${verdict.reason}` });
		return !verdict || verdict.keep;
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

async function callModel<T extends { usage: LanguageModelUsage }>(
	role: ModelCall['role'],
	model: ReviewModel,
	input: ReviewInput,
	run: () => Promise<T>
): Promise<T> {
	const started = performance.now();
	const result = await run();
	await input.onModelCall?.({
		role,
		provider: model.provider,
		modelId: model.modelId,
		usage: result.usage,
		durationMs: Math.round(performance.now() - started)
	});
	return result;
}
