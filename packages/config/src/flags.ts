import type { Env } from './env';
import type { RepoConfig } from './repo-config';

/** Load AGENTS.md / CLAUDE.md / .hansi* from the PR head and inject them into the review prompt. */
export const RULES_INJECTION_FLAG = 'rules_injection';

/**
 * Whether repository review-rule injection is on for this review. Off by default.
 * Enable instance-wide (`HANSI_RULES_INJECTION`), for listed repos, or in `.hansi.json`.
 */
export function isRulesInjectionEnabled(input: {
	env?: Pick<Env, 'HANSI_RULES_INJECTION' | 'HANSI_RULES_INJECTION_REPOS'>;
	config?: Pick<RepoConfig, 'reviews'>;
	repositoryFullName?: string;
}): boolean {
	if (input.config?.reviews.rulesInjection) return true;
	if (input.env?.HANSI_RULES_INJECTION) return true;
	const name = input.repositoryFullName?.trim().toLowerCase();
	if (!name) return false;
	return (input.env?.HANSI_RULES_INJECTION_REPOS ?? []).some((repo) => repo.toLowerCase() === name);
}
