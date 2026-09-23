import { parse } from 'yaml';
import { z } from 'zod';

export const severities = ['info', 'minor', 'major', 'critical'] as const;
export type Severity = (typeof severities)[number];

export const reviewProfiles = ['chill', 'balanced', 'strict'] as const;
export type ReviewProfile = (typeof reviewProfiles)[number];

/** Schema of `.hans.yml` in the repository root. Every field is optional. */
export const repoConfigSchema = z.object({
	reviews: z
		.object({
			enabled: z.boolean().default(true),
			/** Review automatically when a PR is opened or updated. Mentions always work. */
			auto: z.boolean().default(true),
			drafts: z.boolean().default(false),
			/** Only review PRs targeting these branches. Empty means all branches. */
			base_branches: z.array(z.string()).default([]),
			/** Globs; prefix with `!` to exclude, e.g. `["!**\/*.snap", "!docs/**"]`. */
			path_filters: z.array(z.string()).default([]),
			profile: z.enum(reviewProfiles).default('balanced'),
			min_severity: z.enum(severities).default('minor'),
			max_comments: z.number().int().min(0).max(100).default(15),
			/** Approve pull requests that have no blocking findings. */
			approve: z.boolean().default(true),
			/**
			 * Findings at or above this severity block the PR: hans requests changes. `never` only
			 * comments (and never approves a PR with major or critical findings).
			 */
			request_changes: z.enum([...severities, 'never']).default('major')
		})
		.prefault({}),
	/** Free-form instructions appended to the review prompt. */
	instructions: z.string().default(''),
	path_instructions: z.array(z.object({ path: z.string(), instructions: z.string() })).default([]),
	/** Language for review comments, e.g. `en`, `de`. */
	language: z.string().default('en')
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export const defaultRepoConfig: RepoConfig = repoConfigSchema.parse({});

export type RepoConfigResult =
	{ ok: true; config: RepoConfig } | { ok: false; config: RepoConfig; errors: string[] };

/** Parses `.hans.yml`. Invalid files fall back to defaults and report errors instead of throwing. */
export function parseRepoConfig(source: string | null | undefined): RepoConfigResult {
	if (!source?.trim()) return { ok: true, config: defaultRepoConfig };

	let raw: unknown;
	try {
		raw = parse(source);
	} catch (error) {
		return { ok: false, config: defaultRepoConfig, errors: [`Invalid YAML: ${String(error)}`] };
	}

	const result = repoConfigSchema.safeParse(raw ?? {});
	if (result.success) return { ok: true, config: result.data };
	return {
		ok: false,
		config: defaultRepoConfig,
		errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
	};
}

/** The severity from which findings block a PR (see `reviews.request_changes`). */
export function blockingSeverity(config: RepoConfig): Severity {
	return config.reviews.request_changes === 'never' ? 'major' : config.reviews.request_changes;
}

export function severityAtLeast(severity: Severity, minimum: Severity): boolean {
	return severities.indexOf(severity) >= severities.indexOf(minimum);
}
