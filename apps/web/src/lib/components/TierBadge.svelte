<script lang="ts">
	let { tier, size = 'sm' }: { tier: string | null; size?: 'sm' | 'lg' } = $props();

	const styles: Record<string, string> = {
		S: 'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
		A: 'bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800',
		B: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
		C: 'bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800',
		D: 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
		F: 'bg-stone-800 text-white ring-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:ring-stone-300'
	};
</script>

{#if tier}
	<span
		class="inline-flex items-center justify-center rounded-md font-mono font-bold ring-1 {styles[
			tier
		] ?? ''} {size === 'lg' ? 'size-12 text-2xl' : 'size-6 text-sm'}"
		title="Tier {tier}"
	>
		{tier}
	</span>
{:else}
	<span class="muted">–</span>
{/if}
