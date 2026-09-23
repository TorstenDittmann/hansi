import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '@hans/config';
import type { ModelCall, ReviewModel } from '@hans/core';
import { schema, type Database } from '@hans/db';
import {
	botMention,
	getInstallationOctokit,
	loadGitHubAppCredentials,
	parseFullName,
	type Octokit,
	type RepoRef
} from '@hans/github';
import {
	createLanguageModel,
	decryptSecret,
	estimateCost,
	findPrice,
	loadPriceCatalog,
	type ProviderId
} from '@hans/llm';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Logger } from 'pino';

export interface WorkerContext {
	db: Database;
	env: Env;
	logger: Logger;
}

export interface RepositoryConnection {
	repository: typeof schema.repositories.$inferSelect;
	octokit: Octokit;
	ref: RepoRef;
	/** The bot's handle, e.g. `@hansi-codes`. */
	mention: string;
}

/** Installation-authenticated access to a repository, or null if it is no longer installed. */
export async function connectRepository(
	{ db, env }: WorkerContext,
	repositoryId: number
): Promise<RepositoryConnection | null> {
	const [row] = await db
		.select({ repository: schema.repositories, installationId: schema.githubInstallations.id })
		.from(schema.repositories)
		.innerJoin(
			schema.githubInstallations,
			eq(schema.githubInstallations.id, schema.repositories.installationId)
		)
		.where(eq(schema.repositories.id, repositoryId));
	if (!row) return null;

	const credentials = await loadGitHubAppCredentials(db, env);
	if (!credentials) throw new Error('GitHub App is not configured');
	return {
		repository: row.repository,
		octokit: await getInstallationOctokit(credentials, row.installationId),
		ref: parseFullName(row.repository.fullName),
		mention: botMention(credentials)
	};
}

export async function loadModels({ db, env }: WorkerContext, organizationId: string) {
	const assignments = await db
		.select({ assignment: schema.modelAssignments, credential: schema.providerCredentials })
		.from(schema.modelAssignments)
		.innerJoin(
			schema.providerCredentials,
			eq(schema.providerCredentials.id, schema.modelAssignments.credentialId)
		)
		.where(
			and(
				eq(schema.modelAssignments.organizationId, organizationId),
				eq(schema.providerCredentials.organizationId, organizationId)
			)
		);

	const resolve = async (role: 'review' | 'verify'): Promise<ReviewModel | undefined> => {
		const entry = assignments.find((a) => a.assignment.role === role);
		if (!entry) return undefined;
		const apiKey = await decryptSecret(
			entry.credential.encryptedKey,
			env.HANS_ENCRYPTION_KEY,
			`provider_credentials:${entry.credential.id}`
		);
		return {
			model: createLanguageModel(
				{ provider: entry.credential.provider, apiKey, baseUrl: entry.credential.baseUrl },
				entry.assignment.modelId
			),
			provider: entry.credential.provider,
			modelId: entry.assignment.modelId
		};
	};

	const review = await resolve('review');
	if (!review) {
		throw new Error('No review model configured. Add a provider key in Settings → Models.');
	}
	return { review, verify: await resolve('verify') };
}

/** Learnings for a repository: its own plus the organization-wide ones. */
export async function loadLearnings(db: Database, organizationId: string, repositoryId: number) {
	const rows = await db
		.select({ body: schema.learnings.body })
		.from(schema.learnings)
		.where(
			and(
				eq(schema.learnings.organizationId, organizationId),
				or(isNull(schema.learnings.repositoryId), eq(schema.learnings.repositoryId, repositoryId))
			)
		)
		.orderBy(schema.learnings.createdAt)
		.limit(100);
	return rows.map((row) => row.body);
}

/** Writes each model call to `llm_calls` with its cost, and keeps running totals. */
export async function createUsageRecorder(
	db: Database,
	scope: { organizationId: string; reviewId?: string }
) {
	const catalog = await loadPriceCatalog();
	const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
	const record = async (call: ModelCall) => {
		const cost = estimateCost(
			findPrice(catalog, call.provider as ProviderId, call.modelId),
			call.usage
		);
		totals.inputTokens += call.usage.inputTokens ?? 0;
		totals.outputTokens += call.usage.outputTokens ?? 0;
		totals.costUsd += cost ?? 0;
		await db.insert(schema.llmCalls).values({
			reviewId: scope.reviewId ?? null,
			organizationId: scope.organizationId,
			role: call.role,
			provider: call.provider,
			model: call.modelId,
			inputTokens: call.usage.inputTokens ?? 0,
			outputTokens: call.usage.outputTokens ?? 0,
			cachedInputTokens: call.usage.inputTokenDetails?.cacheReadTokens ?? 0,
			costUsd: cost,
			durationMs: call.durationMs
		});
	};
	return { record, totals };
}

/** Runs `fn` with a fresh temporary directory that is always removed afterwards. */
export async function withWorkdir<T>(env: Env, fn: (dir: string) => Promise<T>): Promise<T> {
	const root = env.WORKER_WORKDIR ?? join(tmpdir(), 'hans');
	await mkdir(root, { recursive: true });
	const dir = await mkdtemp(join(root, 'job-'));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
