import { expect, test } from 'bun:test';
import { parseReasoningEffort } from './reasoning';

test('empty input means the provider default', () => {
	expect(parseReasoningEffort(null)).toBeNull();
	expect(parseReasoningEffort(undefined)).toBeNull();
	expect(parseReasoningEffort('')).toBeNull();
	expect(parseReasoningEffort('  ')).toBeNull();
});

test('accepts the shared effort levels', () => {
	expect(parseReasoningEffort('high')).toBe('high');
	expect(parseReasoningEffort(' xhigh ')).toBe('xhigh');
});

test('rejects an unknown level', () => {
	expect(parseReasoningEffort('max')).toBeUndefined();
	expect(parseReasoningEffort(1)).toBeUndefined();
});
