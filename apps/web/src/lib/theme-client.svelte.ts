import { browser } from '$app/environment';
import {
	THEME_STORAGE_KEY,
	applyTheme,
	nextTheme,
	readStoredThemeFrom,
	systemPrefersDark,
	writeStoredTheme,
	type Theme
} from './theme';

/** Shared with the account-menu row. The layout keeps this in sync for the whole visit. */
export const themePreference = $state({
	theme: 'system' as Theme,
	systemDark: false
});

function apply() {
	if (!browser) return;
	applyTheme(document.documentElement, themePreference.theme, themePreference.systemDark);
}

export function cycleTheme() {
	themePreference.theme = nextTheme(themePreference.theme, themePreference.systemDark);
	writeStoredTheme(themePreference.theme);
	apply();
}

/**
 * Follow the saved theme, including OS changes while the account menu is closed.
 * The menu row mounts only while that menu is open, so the listener has to live here.
 */
export function startThemeSync() {
	if (!browser) return () => {};
	themePreference.theme = readStoredThemeFrom(() => localStorage);
	themePreference.systemDark = systemPrefersDark();
	apply();

	let media: MediaQueryList | undefined;
	const onMedia = (event: MediaQueryListEvent) => {
		themePreference.systemDark = event.matches;
		if (themePreference.theme === 'system') apply();
	};
	const onStorage = (event: StorageEvent) => {
		if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
		themePreference.theme = readStoredThemeFrom(() => localStorage);
		apply();
	};
	try {
		media = window.matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', onMedia);
	} catch {
		// matchMedia can throw when preference queries are blocked.
	}
	window.addEventListener('storage', onStorage);
	return () => {
		media?.removeEventListener('change', onMedia);
		window.removeEventListener('storage', onStorage);
	};
}
