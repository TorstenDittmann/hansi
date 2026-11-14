import { expect, test } from 'bun:test';
import { formatSunsetDate, sunsetDescription } from './sunset';

test('the shutdown date is written out in UTC', () => {
	expect(formatSunsetDate('2026-12-31')).toBe('December 31, 2026');
	expect(formatSunsetDate('2027-01-01')).toBe('January 1, 2027');
});

test('the description names the date and self-hosting', () => {
	const description = sunsetDescription('2026-12-31');
	expect(description).toContain('December 31, 2026');
	expect(description).toContain('run it yourself');
});
