import { expect, test } from 'bun:test';
import { formatDuration } from './format';

const start = new Date('2026-01-01T00:00:00.000Z');

test('formats short durations in seconds and longer ones in minutes', () => {
	expect(formatDuration(start, new Date('2026-01-01T00:00:45.000Z'))).toBe('45s');
	expect(formatDuration(start, new Date('2026-01-01T00:02:05.000Z'))).toBe('2m 5s');
	expect(formatDuration(start, new Date('2026-01-01T00:01:00.000Z'))).toBe('1m 0s');
});

test('uses now when the end time is missing so a running review can tick', () => {
	expect(formatDuration(start, null, new Date('2026-01-01T00:00:12.400Z'))).toBe('12s');
	expect(formatDuration(start, undefined, new Date('2026-01-01T00:03:01.000Z'))).toBe('3m 1s');
});

test('is an em dash until the review has started', () => {
	expect(formatDuration(null, null, start)).toBe('–');
	expect(formatDuration(undefined, start)).toBe('–');
});

test('does not go negative if now is before startedAt', () => {
	expect(formatDuration(start, null, new Date('2025-12-31T23:59:50.000Z'))).toBe('0s');
});
