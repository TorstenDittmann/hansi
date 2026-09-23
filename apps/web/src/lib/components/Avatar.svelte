<script lang="ts">
	// A picture when there is one, otherwise the name's first letter. Organizations are square.
	let {
		name,
		image = null,
		square = false,
		class: className = 'size-7 text-xs'
	}: { name: string; image?: string | null; square?: boolean; class?: string } = $props();
</script>

{#if image}
	<img
		src={image}
		alt=""
		class="shrink-0 object-cover {square ? 'rounded-md' : 'rounded-full'} {className}"
	/>
{:else}
	<span
		class="inline-flex shrink-0 items-center justify-center bg-stone-900 font-semibold text-white uppercase dark:bg-stone-100 dark:text-stone-900 {square
			? 'rounded-md'
			: 'rounded-full'} {className}"
		aria-hidden="true">{name.trim().charAt(0) || '?'}</span
	>
{/if}
