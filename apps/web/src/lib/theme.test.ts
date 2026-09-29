import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	THEME_STORAGE_KEY,
	applyTheme,
	nextTheme,
	parseTheme,
	readStoredTheme,
	readStoredThemeFrom,
	resolveDark,
	systemPrefersDark,
	themeName,
	writeStoredTheme,
	type Theme
} from './theme';

test('unknown saved values follow the system theme', () => {
	expect(parseTheme(null)).toBe('system');
	expect(parseTheme(undefined)).toBe('system');
	expect(parseTheme('')).toBe('system');
	expect(parseTheme('sepia')).toBe('system');
	expect(parseTheme('light')).toBe('light');
	expect(parseTheme('dark')).toBe('dark');
	expect(parseTheme('system')).toBe('system');
});

test('reads the saved theme and falls back when storage throws', () => {
	expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark');
	expect(readStoredTheme({ getItem: () => null })).toBe('system');
	expect(
		readStoredTheme({
			getItem() {
				throw new Error('blocked');
			}
		})
	).toBe('system');
});

test('falls back when reaching storage or the system preference throws', () => {
	expect(readStoredThemeFrom(() => ({ getItem: () => 'light' }))).toBe('light');
	expect(
		readStoredThemeFrom(() => {
			throw new Error('blocked');
		})
	).toBe('system');
	expect(systemPrefersDark(() => true)).toBe(true);
	expect(
		systemPrefersDark(() => {
			throw new Error('blocked');
		})
	).toBe(false);

	let saved: string | undefined;
	writeStoredTheme('dark', () => ({
		setItem(_key, value) {
			saved = value;
		}
	}));
	expect(saved).toBe('dark');
	expect(() =>
		writeStoredTheme('light', () => {
			throw new Error('blocked');
		})
	).not.toThrow();
});

test('resolves system from the operating system and pins an explicit choice', () => {
	expect(resolveDark('system', true)).toBe(true);
	expect(resolveDark('system', false)).toBe(false);
	expect(resolveDark('dark', false)).toBe(true);
	expect(resolveDark('light', true)).toBe(false);
});

test('cycles through light, dark, and system, flipping colors on the way off system', () => {
	expect(nextTheme('system', true)).toBe('light');
	expect(nextTheme('light', true)).toBe('dark');
	expect(nextTheme('dark', true)).toBe('system');

	expect(nextTheme('system', false)).toBe('dark');
	expect(nextTheme('dark', false)).toBe('light');
	expect(nextTheme('light', false)).toBe('system');
});

test('returns to the start after one step per theme', () => {
	for (const systemPrefersDark of [true, false]) {
		let theme: Theme = 'system';
		const seen = new Set<Theme>([theme]);
		for (let step = 0; step < 3; step++) {
			theme = nextTheme(theme, systemPrefersDark);
			seen.add(theme);
		}
		expect(theme).toBe('system');
		expect(seen).toEqual(new Set(['system', 'light', 'dark']));
	}
});

test('names themes for the toggle label', () => {
	expect(themeName('light')).toBe('Light');
	expect(themeName('dark')).toBe('Dark');
	expect(themeName('system')).toBe('System');
});

test('applyTheme sets the dark class and the icon selector together', () => {
	const classes = new Set<string>();
	const root = {
		classList: {
			toggle(token: string, force?: boolean) {
				if (force) classes.add(token);
				else classes.delete(token);
			}
		},
		dataset: {} as { theme?: string }
	};

	applyTheme(root, 'dark', false);
	expect(classes.has('dark')).toBe(true);
	expect(root.dataset.theme).toBe('dark');

	applyTheme(root, 'system', false);
	expect(classes.has('dark')).toBe(false);
	expect(root.dataset.theme).toBe('system');

	applyTheme(root, 'system', true);
	expect(classes.has('dark')).toBe(true);
});

test('the boot script uses the same storage key and decision as the theme module', () => {
	const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8').replace(/\s+/g, ' ');
	expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
	expect(html).toContain("stored === 'light' || stored === 'dark' || stored === 'system'");
	expect(html).toContain(
		"theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)"
	);
	expect(html).toContain("classList.toggle('dark', dark)");
	expect(html).toContain('dataset.theme = theme');
});
