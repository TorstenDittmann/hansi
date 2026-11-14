import { expect, test } from 'bun:test';
import { parseEnv } from './env';

const base = {
	HANS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
	BETTER_AUTH_SECRET: 'x'.repeat(32)
};

test('the sunset date is unset by default and when empty', () => {
	expect(parseEnv(base).SUNSET_DATE).toBeUndefined();
	expect(parseEnv({ ...base, SUNSET_DATE: '' }).SUNSET_DATE).toBeUndefined();
	expect(parseEnv({ ...base, SUNSET_DATE: '  ' }).SUNSET_DATE).toBeUndefined();
});

test('the sunset date must be a YYYY-MM-DD date', () => {
	expect(parseEnv({ ...base, SUNSET_DATE: '2026-12-31' }).SUNSET_DATE).toBe('2026-12-31');
	expect(() => parseEnv({ ...base, SUNSET_DATE: 'soon' })).toThrow('SUNSET_DATE');
});
