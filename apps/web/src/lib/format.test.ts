import { expect, test } from 'bun:test';
import { formatDate, formatDay, formatDuration } from './format';

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

test('formats dates in UTC without using the runtime locale', () => {
	expect(formatDate('2026-09-28T12:36:00.000Z')).toBe('Sep 28, 2026, 12:36 PM');
	expect(formatDate('2026-09-01T00:05:00.000Z')).toBe('Sep 1, 2026, 12:05 AM');
	expect(formatDate('2026-09-01T23:05:00.000Z')).toBe('Sep 1, 2026, 11:05 PM');
	expect(formatDate(null)).toBe('–');
	expect(formatDate(undefined)).toBe('–');
});

test('formats a calendar day from the date string', () => {
	expect(formatDay('2026-09-01')).toBe('Sep 1');
	expect(formatDay('2026-09-28')).toBe('Sep 28');
	expect(formatDay('2026-01-09')).toBe('Jan 9');
});
