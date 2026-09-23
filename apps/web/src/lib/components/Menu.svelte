<script lang="ts">
	import type { Snippet } from 'svelte';
	import { afterNavigate } from '$app/navigation';

	// A button that opens a dropdown panel. Closes on outside click, Escape, and navigation.
	let {
		label,
		trigger,
		children,
		align = 'left',
		class: className = ''
	}: {
		label: string;
		trigger: Snippet;
		children: Snippet;
		align?: 'left' | 'right';
		class?: string;
	} = $props();

	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let button: HTMLButtonElement | undefined = $state();

	afterNavigate(() => (open = false));
</script>

<svelte:window
	onclick={(event) => {
		if (open && !root?.contains(event.target as Node)) open = false;
	}}
	onkeydown={(event) => {
		if (open && event.key === 'Escape') {
			open = false;
			button?.focus();
		}
	}}
/>

<div class="relative" bind:this={root}>
	<button
		bind:this={button}
		type="button"
		class={className}
		aria-label={label}
		aria-haspopup="true"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		{@render trigger()}
	</button>
	{#if open}
		<div
			class="absolute top-full z-20 mt-2 w-64 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg shadow-stone-900/5 dark:border-stone-800 dark:bg-stone-900 {align ===
			'right'
				? 'right-0'
				: 'left-0'}"
		>
			{@render children()}
		</div>
	{/if}
</div>
