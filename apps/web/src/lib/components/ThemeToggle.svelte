<script lang="ts">
	import { cycleTheme, themePreference } from '$lib/theme-client.svelte';
	import { nextTheme, themeName } from '$lib/theme';

	// Icons follow `data-theme` on <html>. The layout keeps that in sync for the whole visit;
	// this row only exists while the account menu is open.
	const theme = $derived(themePreference.theme);
	const upcoming = $derived(nextTheme(theme, themePreference.systemDark));
	const label = $derived(
		`${themeName(theme)} theme. Switch to ${themeName(upcoming).toLowerCase()} theme.`
	);
</script>

<button
	type="button"
	class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800"
	aria-label={label}
	onclick={cycleTheme}
>
	<svg
		viewBox="0 0 16 16"
		class="theme-mark theme-mark-light size-4"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		aria-hidden="true"
	>
		<circle cx="8" cy="8" r="2.25" />
		<path
			d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.4 3.4l1.05 1.05M11.55 11.55l1.05 1.05M3.4 12.6l1.05-1.05M11.55 4.45l1.05-1.05"
		/>
	</svg>
	<svg
		viewBox="0 0 16 16"
		class="theme-mark theme-mark-dark size-4"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M13.2 9.1A5.1 5.1 0 0 1 6.9 2.8 5.25 5.25 0 1 0 13.2 9.1Z" />
	</svg>
	<svg
		viewBox="0 0 16 16"
		class="theme-mark theme-mark-system size-4"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="1.75" y="2.25" width="12.5" height="8.5" rx="1.25" />
		<path d="M5.5 13.75h5M8 10.75v3" />
	</svg>
	<span class="flex-1">Theme</span>
	<span class="text-stone-500 dark:text-stone-400">{themeName(theme)}</span>
</button>
