import { describe, expect, test } from 'bun:test';
import { defaultRepoConfig, parseRepoConfig, severityAtLeast } from './repo-config';

describe('parseRepoConfig', () => {
	test('returns defaults for a missing file', () => {
		expect(parseRepoConfig(null)).toEqual({ ok: true, config: defaultRepoConfig });
		expect(defaultRepoConfig.reviews.profile).toBe('chill');
	});

	test('merges partial config with defaults', () => {
		const result = parseRepoConfig('reviews:\n  profile: strict\n  path_filters: ["!docs/**"]\n');
		expect(result.ok).toBe(true);
		expect(result.config.reviews.profile).toBe('strict');
		expect(result.config.reviews.path_filters).toEqual(['!docs/**']);
		expect(result.config.reviews.max_comments).toBe(15);
	});

	test('falls back to defaults on invalid values', () => {
		const result = parseRepoConfig('reviews:\n  profile: nitpicky\n');
		expect(result.ok).toBe(false);
		expect(result.config).toEqual(defaultRepoConfig);
	});

	test('falls back to defaults on invalid YAML', () => {
		expect(parseRepoConfig('reviews: [').ok).toBe(false);
	});
});

test('severityAtLeast', () => {
	expect(severityAtLeast('major', 'minor')).toBe(true);
	expect(severityAtLeast('info', 'minor')).toBe(false);
});

test('verdict settings default to approving and requesting changes on major findings', () => {
	expect(defaultRepoConfig.reviews.approve).toBe(true);
	expect(defaultRepoConfig.reviews.request_changes).toBe('major');
	const commentOnly = parseRepoConfig('reviews:\n  request_changes: never\n  approve: false\n');
	expect(commentOnly.ok).toBe(true);
	expect(commentOnly.config.reviews.request_changes).toBe('never');
});
