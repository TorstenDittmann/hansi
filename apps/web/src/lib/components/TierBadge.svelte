<script lang="ts">
	let { tier, size = 'sm' }: { tier: string | null; size?: 'sm' | 'lg' } = $props();

	const styles: Record<string, string> = {
		S: 'bg-violet-100 text-violet-800 ring-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800',
		A: 'bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
		B: 'bg-lime-100 text-lime-800 ring-lime-300 dark:bg-lime-950 dark:text-lime-200 dark:ring-lime-800',
		C: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
		D: 'bg-orange-100 text-orange-800 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800',
		F: 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800'
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
