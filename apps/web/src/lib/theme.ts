/** Saved appearance. `system` follows the operating system. */
export type Theme = 'light' | 'dark' | 'system';

/** Key shared with the boot script in `src/app.html`, which runs before paint. */
export const THEME_STORAGE_KEY = 'theme';

export function parseTheme(value: string | null | undefined): Theme {
	if (value === 'light' || value === 'dark' || value === 'system') return value;
	return 'system';
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'>): Theme {
	try {
		return parseTheme(storage.getItem(THEME_STORAGE_KEY));
	} catch {
		// Some browsers throw on any storage access when it is blocked.
		return 'system';
	}
}

/** Reads the saved theme. Accessing storage itself can throw before `getItem` runs. */
export function readStoredThemeFrom(getStorage: () => Pick<Storage, 'getItem'>): Theme {
	try {
		return readStoredTheme(getStorage());
	} catch {
		return 'system';
	}
}

export function writeStoredTheme(
	theme: Theme,
	getStorage: () => Pick<Storage, 'setItem'> = () => localStorage
) {
	try {
		getStorage().setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// The choice still applies for this visit when storage is blocked.
	}
}

export function systemPrefersDark(match: () => boolean = matchSystemDark): boolean {
	try {
		return match();
	} catch {
		return false;
	}
}

function matchSystemDark() {
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(theme: Theme, systemPrefersDark: boolean): boolean {
	if (theme === 'dark') return true;
	if (theme === 'light') return false;
	return systemPrefersDark;
}

/**
 * Next choice in the cycle. From "system", the next choice is the opposite of the
 * current appearance, so the first click always changes the colors. Every theme
 * stays reachable: the step that would not change colors returns to "system".
 */
export function nextTheme(theme: Theme, systemPrefersDark: boolean): Theme {
	if (theme === 'system') return systemPrefersDark ? 'light' : 'dark';
	if (theme === 'light') return systemPrefersDark ? 'dark' : 'system';
	return systemPrefersDark ? 'system' : 'light';
}

export function themeName(theme: Theme): string {
	if (theme === 'light') return 'Light';
	if (theme === 'dark') return 'Dark';
	return 'System';
}

export function applyTheme(
	root: {
		classList: { toggle(token: string, force?: boolean): void };
		dataset: { theme?: string };
	},
	theme: Theme,
	systemPrefersDark: boolean
) {
	root.classList.toggle('dark', resolveDark(theme, systemPrefersDark));
	root.dataset.theme = theme;
}
