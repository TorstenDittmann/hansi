<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import '@fontsource-variable/martian-mono';
	import Logo from '$lib/components/Logo.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Same destination as the homepage: sign in once GitHub is configured, otherwise setup.
	const start = $derived(page.data.configured ? resolve('/login') : resolve('/setup'));
	const path = $derived(
		page.url.pathname.length > 1 && page.url.pathname.endsWith('/')
			? page.url.pathname.slice(0, -1)
			: page.url.pathname || '/'
	);
	const onHome = $derived(path === '/');
	const onDocs = $derived(path === '/docs');
	const anchor = (id: string) => (onHome ? `#${id}` : `${resolve('/')}#${id}`);

	const focus =
		'rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-400';
	const button = `inline-flex items-center justify-center rounded-[0.6rem] bg-stone-900 font-semibold text-white transition-colors hover:bg-stone-700 motion-reduce:transition-none dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300 ${focus}`;
	const navLink = `font-medium text-stone-500 transition-colors hover:text-stone-900 motion-reduce:transition-none dark:text-stone-400 dark:hover:text-stone-100 ${focus}`;
	const navItem = (current: boolean) =>
		current ? `font-medium text-stone-900 dark:text-stone-100 ${focus}` : navLink;
</script>

<div
	class="min-h-screen bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100"
>
	<header class="mx-auto flex h-18 max-w-[70rem] items-center justify-between px-4 sm:px-6">
		<a
			href={resolve('/')}
			class="flex items-center gap-2.5 font-display text-xl font-bold tracking-[-0.04em] {focus}"
		>
			<Logo class="size-6" />Hansi
		</a>
		<nav aria-label="Main" class="flex items-center gap-7">
			<!-- The hash is appended to resolve('/'). The rule cannot see through that. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a href={anchor('pricing')} class="hidden sm:inline {navLink}">Pricing</a>
			<a href={anchor('faq')} class="hidden sm:inline {navLink}">FAQ</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<a
				href={resolve('/docs')}
				class="hidden sm:inline {navItem(onDocs)}"
				aria-current={onDocs ? 'page' : undefined}>Docs</a
			>
			<a href={start} class="hidden sm:inline {navLink}">Sign in</a>
			<a href={start} class="px-4 py-2 text-sm {button}">Get started</a>
		</nav>
	</header>

	<main class="mx-auto max-w-[70rem] px-4 sm:px-6">
		{@render children()}
	</main>

	<footer
		class="mx-auto flex max-w-[70rem] items-center justify-between border-t border-stone-200 px-4 py-8 sm:px-6 dark:border-stone-800"
	>
		<span class="flex items-center gap-2 font-display text-lg font-bold tracking-[-0.04em]"
			><Logo class="size-5" />Hansi</span
		>
		<nav aria-label="Footer" class="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-6">
			<a
				href="https://github.com/TorstenDittmann/hansi"
				class="flex items-center gap-2 {navLink}"
				target="_blank"
				rel="noreferrer"
			>
				<svg viewBox="0 0 16 16" class="size-4" fill="currentColor" aria-hidden="true">
					<path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
					/>
				</svg>
				GitHub
			</a>
			<a href={resolve('/docs')} class={navItem(onDocs)} aria-current={onDocs ? 'page' : undefined}
				>Docs</a
			>
			<a href={start} class={navLink}>Sign in</a>
		</nav>
	</footer>
</div>
