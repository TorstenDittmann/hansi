import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';

const createdAt = integer('created_at', { mode: 'timestamp_ms' })
	.notNull()
	.default(sql`(unixepoch() * 1000)`);
const updatedAt = integer('updated_at', { mode: 'timestamp_ms' })
	.notNull()
	.default(sql`(unixepoch() * 1000)`)
	.$onUpdate(() => new Date());

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const organizationId = () =>
	text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' });

/** Instance-wide key/value settings (e.g. encrypted GitHub App credentials). */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull(),
	updatedAt
});

export const githubInstallations = sqliteTable(
	'github_installations',
	{
		/** GitHub's installation id. */
		id: integer('id').primaryKey(),
		/** Null until a user of this instance claims the installation. */
		organizationId: text('organization_id').references(() => organization.id, {
			onDelete: 'set null'
		}),
		accountLogin: text('account_login').notNull(),
		accountType: text('account_type').notNull(),
		suspendedAt: integer('suspended_at', { mode: 'timestamp_ms' }),
		createdAt,
		updatedAt
	},
	(t) => [index('github_installations_org_idx').on(t.organizationId)]
);

export const repositories = sqliteTable(
	'repositories',
	{
		/** GitHub's repository id. */
		id: integer('id').primaryKey(),
		installationId: integer('installation_id')
			.notNull()
			.references(() => githubInstallations.id, { onDelete: 'cascade' }),
		fullName: text('full_name').notNull(),
		private: integer('private', { mode: 'boolean' }).notNull(),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		createdAt,
		updatedAt
	},
	(t) => [index('repositories_installation_idx').on(t.installationId)]
);

export const providerIds = [
	'openai',
	'anthropic',
	'xai',
	'google',
	'openrouter',
	'openai-compatible'
] as const;
export type ProviderId = (typeof providerIds)[number];

/** BYOK credentials. `encryptedKey` is AES-256-GCM, bound to the row id. */
export const providerCredentials = sqliteTable(
	'provider_credentials',
	{
		id: id(),
		organizationId: organizationId(),
		provider: text('provider', { enum: providerIds }).notNull(),
		label: text('label').notNull(),
		baseUrl: text('base_url'),
		encryptedKey: text('encrypted_key').notNull(),
		/** Last four characters of the key, for display. */
		keyHint: text('key_hint').notNull(),
		lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp_ms' }),
		createdAt,
		updatedAt
	},
	(t) => [index('provider_credentials_org_idx').on(t.organizationId)]
);

export const modelRoles = ['review', 'verify'] as const;
export type ModelRole = (typeof modelRoles)[number];

export const modelAssignments = sqliteTable(
	'model_assignments',
	{
		organizationId: organizationId(),
		role: text('role', { enum: modelRoles }).notNull(),
		credentialId: text('credential_id')
			.notNull()
			.references(() => providerCredentials.id, { onDelete: 'cascade' }),
		modelId: text('model_id').notNull(),
		updatedAt
	},
	(t) => [primaryKey({ columns: [t.organizationId, t.role] })]
);

export const reviewStatuses = [
	'queued',
	'running',
	'completed',
	'failed',
	'skipped',
	'superseded'
] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export const reviewTriggers = ['opened', 'synchronize', 'mention', 'manual'] as const;
export type ReviewTrigger = (typeof reviewTriggers)[number];

export const reviews = sqliteTable(
	'reviews',
	{
		id: id(),
		organizationId: organizationId(),
		repositoryId: integer('repository_id')
			.notNull()
			.references(() => repositories.id, { onDelete: 'cascade' }),
		pullNumber: integer('pull_number').notNull(),
		headSha: text('head_sha').notNull(),
		status: text('status', { enum: reviewStatuses }).notNull().default('queued'),
		trigger: text('trigger', { enum: reviewTriggers }).notNull(),
		summary: text('summary'),
		error: text('error'),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		costUsd: real('cost_usd').notNull().default(0),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }),
		finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
		createdAt
	},
	(t) => [
		index('reviews_org_created_idx').on(t.organizationId, t.createdAt),
		index('reviews_repo_pr_idx').on(t.repositoryId, t.pullNumber)
	]
);

export const findingStatuses = ['posted', 'dropped', 'resolved', 'dismissed'] as const;

export const reviewFindings = sqliteTable(
	'review_findings',
	{
		id: id(),
		reviewId: text('review_id')
			.notNull()
			.references(() => reviews.id, { onDelete: 'cascade' }),
		path: text('path').notNull(),
		startLine: integer('start_line').notNull(),
		endLine: integer('end_line').notNull(),
		severity: text('severity').notNull(),
		category: text('category').notNull(),
		title: text('title').notNull(),
		body: text('body').notNull(),
		suggestion: text('suggestion'),
		status: text('status', { enum: findingStatuses }).notNull(),
		dropReason: text('drop_reason'),
		githubCommentId: integer('github_comment_id'),
		createdAt
	},
	(t) => [index('review_findings_review_idx').on(t.reviewId)]
);

/** Trace of what the agent did during a review: tool calls, verdicts, errors. */
export const reviewEvents = sqliteTable(
	'review_events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		reviewId: text('review_id')
			.notNull()
			.references(() => reviews.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt
	},
	(t) => [index('review_events_review_idx').on(t.reviewId)]
);

export const llmCalls = sqliteTable(
	'llm_calls',
	{
		id: id(),
		reviewId: text('review_id').references(() => reviews.id, { onDelete: 'cascade' }),
		organizationId: organizationId(),
		role: text('role').notNull(),
		provider: text('provider').notNull(),
		model: text('model').notNull(),
		inputTokens: integer('input_tokens').notNull().default(0),
		outputTokens: integer('output_tokens').notNull().default(0),
		cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
		/** Null when pricing for the model is unknown. */
		costUsd: real('cost_usd'),
		durationMs: integer('duration_ms').notNull(),
		createdAt
	},
	(t) => [
		index('llm_calls_org_created_idx').on(t.organizationId, t.createdAt),
		index('llm_calls_review_idx').on(t.reviewId)
	]
);

/** GitHub may redeliver webhooks; the delivery GUID dedupes them. */
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
	id: text('id').primaryKey(),
	event: text('event').notNull(),
	receivedAt: createdAt
});
