<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import {
		THEME_STORAGE_KEY,
		applyTheme,
		nextTheme,
		parseTheme,
		readStoredTheme,
		themeName,
		type Theme
	} from '$lib/theme';

	// Icons are selected with CSS from `data-theme` on <html>, which the boot script in
	// app.html sets before paint. The label stays generic until after hydration so the
	// server and client render the same text.
	let theme = $state<Theme>(browser ? readStoredTheme(localStorage) : 'system');
	let systemDark = $state(
		browser ? window.matchMedia('(prefers-color-scheme: dark)').matches : false
	);
	let announced = $state(false);
	const upcoming = $derived(nextTheme(theme, systemDark));
	const label = $derived(
		announced
			? `${themeName(theme)} theme. Switch to ${themeName(upcoming).toLowerCase()} theme.`
			: 'Toggle color theme'
	);

	$effect(() => {
		if (!browser) return;
		applyTheme(document.documentElement, theme, systemDark);
	});

	onMount(() => {
		announced = true;
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const onMedia = (event: MediaQueryListEvent) => {
			systemDark = event.matches;
		};
		const onStorage = (event: StorageEvent) => {
			if (event.key === THEME_STORAGE_KEY) theme = parseTheme(event.newValue);
		};
		media.addEventListener('change', onMedia);
		window.addEventListener('storage', onStorage);
		return () => {
			media.removeEventListener('change', onMedia);
			window.removeEventListener('storage', onStorage);
		};
	});

	function cycle() {
		theme = nextTheme(theme, systemDark);
		try {
			localStorage.setItem(THEME_STORAGE_KEY, theme);
		} catch {
			// The choice still applies for this visit when storage is blocked.
		}
	}
</script>

<button
	type="button"
	class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
	aria-label={label}
	title={announced ? `${themeName(theme)} theme` : undefined}
	onclick={cycle}
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
</button>
