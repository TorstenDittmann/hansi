// Runs the review engine against the eval cases with a real model and reports quality and cost.
//
//   EVAL_PROVIDER=anthropic EVAL_MODEL=<model id> EVAL_API_KEY=… bun run eval
//   bun run eval -- --case sql --repeat 3 --min-f1 0.6
//
// Environment: EVAL_PROVIDER, EVAL_MODEL, EVAL_API_KEY (or the provider's usual variable),
// EVAL_BASE_URL (OpenAI-compatible endpoints), EVAL_REGION (Amazon Bedrock), EVAL_VERIFY_MODEL
// (optional, same provider).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseRepoConfig } from '@hans/config';
import { runReview, type ReviewModel } from '@hans/core';
import {
	createLanguageModel,
	estimateCost,
	findPrice,
	loadPriceCatalog,
	providerIds,
	type ProviderId
} from '@hans/llm';
import { cases } from './cases';
import { buildCaseRepository } from './repo';
import { scoreCase, summarize, type CaseScore } from './score';

const { values: args } = parseArgs({
	options: {
		case: { type: 'string' },
		repeat: { type: 'string', default: '1' },
		'min-f1': { type: 'string' },
		out: { type: 'string', default: 'reports' }
	}
});

const keyVariables: Record<ProviderId, string> = {
	openai: 'OPENAI_API_KEY',
	anthropic: 'ANTHROPIC_API_KEY',
	xai: 'XAI_API_KEY',
	google: 'GOOGLE_GENERATIVE_AI_API_KEY',
	openrouter: 'OPENROUTER_API_KEY',
	'amazon-bedrock': 'AWS_BEARER_TOKEN_BEDROCK',
	'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY'
};

function fail(message: string): never {
	console.error(message);
	process.exit(2);
}

const provider = process.env.EVAL_PROVIDER as ProviderId | undefined;
const modelId = process.env.EVAL_MODEL;
if (!provider || !providerIds.includes(provider)) {
	fail(`Set EVAL_PROVIDER to one of: ${providerIds.join(', ')}`);
}
if (!modelId) fail('Set EVAL_MODEL to the model id to evaluate');
const apiKey = process.env.EVAL_API_KEY ?? process.env[keyVariables[provider]] ?? '';
if (!apiKey && provider !== 'openai-compatible') {
	fail(`Set EVAL_API_KEY or ${keyVariables[provider]}`);
}

const credential = {
	provider,
	apiKey,
	baseUrl: process.env.EVAL_BASE_URL,
	region: process.env.EVAL_REGION ?? process.env.AWS_REGION
};
const model = (id: string): ReviewModel => ({
	model: createLanguageModel(credential, id),
	provider,
	modelId: id
});
const models = {
	review: model(modelId),
	verify: process.env.EVAL_VERIFY_MODEL ? model(process.env.EVAL_VERIFY_MODEL) : undefined
};

const selected = cases.filter((c) => !args.case || c.name.includes(args.case));
if (selected.length === 0) fail(`No case matches "${args.case}"`);
const repeat = Math.max(1, Number(args.repeat) || 1);
const catalog = await loadPriceCatalog();
const config = parseRepoConfig('').config;

interface Run {
	case: string;
	attempt: number;
	score: CaseScore;
	costUsd: number | null;
	inputTokens: number;
	outputTokens: number;
	durationMs: number;
	error?: string;
}

const runs: Run[] = [];
console.log(
	`Evaluating ${provider}/${modelId}${models.verify ? ` (verify: ${models.verify.modelId})` : ''} on ${selected.length} case(s) × ${repeat}\n`
);

for (const evalCase of selected) {
	for (let attempt = 1; attempt <= repeat; attempt++) {
		const repo = await buildCaseRepository(evalCase);
		const usage = { costUsd: 0 as number | null, inputTokens: 0, outputTokens: 0 };
		const started = performance.now();
		let run: Run;
		try {
			const result = await runReview({
				repoDir: repo.dir,
				diff: repo.diff,
				pullRequest: {
					title: evalCase.pullRequest.title,
					body: evalCase.pullRequest.body ?? '',
					author: 'eval'
				},
				config,
				models,
				onModelCall: (call) => {
					const cost = estimateCost(findPrice(catalog, provider, call.modelId), call.usage);
					usage.costUsd = cost === null || usage.costUsd === null ? null : usage.costUsd + cost;
					usage.inputTokens += call.usage.inputTokens ?? 0;
					usage.outputTokens += call.usage.outputTokens ?? 0;
				}
			});
			const posted = result.status === 'completed' ? result.posted : [];
			run = {
				case: evalCase.name,
				attempt,
				score: scoreCase(evalCase.expected, posted),
				...usage,
				durationMs: Math.round(performance.now() - started)
			};
		} catch (error) {
			run = {
				case: evalCase.name,
				attempt,
				score: scoreCase(evalCase.expected, []),
				...usage,
				durationMs: Math.round(performance.now() - started),
				error: error instanceof Error ? error.message : String(error)
			};
		} finally {
			await repo.cleanup();
		}
		runs.push(run);

		const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = run.score;
		const status = run.error ? `ERROR ${run.error}` : `TP ${tp}  FP ${fp}  FN ${fn}`;
		console.log(
			`${evalCase.name.padEnd(28)} #${attempt}  ${status.padEnd(20)}  ${(run.durationMs / 1000).toFixed(1)}s  ${usage.costUsd === null ? '$?' : `$${usage.costUsd.toFixed(4)}`}`
		);
		for (const missed of run.score.missed) console.log(`    missed: ${missed.description}`);
		for (const noise of run.score.noise) {
			console.log(`    noise:  ${noise.path}:${noise.startLine} ${noise.title}`);
		}
	}
}

const summary = summarize(runs.map((r) => r.score));
const knownCosts = runs.map((r) => r.costUsd).filter((c): c is number => c !== null);
const totalCost = knownCosts.reduce((sum, c) => sum + c, 0);
console.log(
	`\nprecision ${summary.precision.toFixed(2)}  recall ${summary.recall.toFixed(2)}  F1 ${summary.f1.toFixed(2)}  ` +
		`cost $${totalCost.toFixed(4)}${knownCosts.length < runs.length ? ' (some prices unknown)' : ''}  ` +
		`errors ${runs.filter((r) => r.error).length}`
);

await mkdir(args.out!, { recursive: true });
const reportPath = join(args.out!, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(
	reportPath,
	JSON.stringify(
		{ provider, model: modelId, verifyModel: models.verify?.modelId, summary, runs },
		null,
		2
	)
);
console.log(`Report: ${reportPath}`);

const minF1 = args['min-f1'] ? Number(args['min-f1']) : undefined;
if (minF1 !== undefined && summary.f1 < minF1) {
	console.error(`F1 ${summary.f1.toFixed(2)} is below --min-f1 ${minF1}`);
	process.exit(1);
}
