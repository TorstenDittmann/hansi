import { describe, expect, test } from 'bun:test';
import { isRulesInjectionEnabled, RULES_INJECTION_FLAG } from './flags';
import { parseRepoConfig } from './repo-config';

const off = {
	HANSI_RULES_INJECTION: false,
	HANSI_RULES_INJECTION_REPOS: [] as string[]
};

describe('isRulesInjectionEnabled', () => {
	test('is off by default', () => {
		expect(RULES_INJECTION_FLAG).toBe('rules_injection');
		expect(isRulesInjectionEnabled({})).toBe(false);
		expect(isRulesInjectionEnabled({ env: off, config: parseRepoConfig(null).config })).toBe(false);
	});

	test('turns on from the instance env flag', () => {
		expect(
			isRulesInjectionEnabled({
				env: { ...off, HANSI_RULES_INJECTION: true },
				config: parseRepoConfig(null).config
			})
		).toBe(true);
	});

	test('turns on from .hansi.json', () => {
		const config = parseRepoConfig(JSON.stringify({ reviews: { rulesInjection: true } })).config;
		expect(isRulesInjectionEnabled({ env: off, config })).toBe(true);
	});

	test('turns on when the repository is in the allowlist', () => {
		expect(
			isRulesInjectionEnabled({
				env: { ...off, HANSI_RULES_INJECTION_REPOS: ['Appwrite/Appwrite'] },
				config: parseRepoConfig(null).config,
				repositoryFullName: 'appwrite/appwrite'
			})
		).toBe(true);
		expect(
			isRulesInjectionEnabled({
				env: { ...off, HANSI_RULES_INJECTION_REPOS: ['appwrite/appwrite'] },
				config: parseRepoConfig(null).config,
				repositoryFullName: 'acme/api'
			})
		).toBe(false);
	});
});
