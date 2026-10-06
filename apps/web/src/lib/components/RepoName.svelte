<script lang="ts">
	// `owner/name` as the owner's GitHub avatar plus the bare name. The owner stays readable in
	// the tooltip and for screen readers.
	let { repository }: { repository: string } = $props();
	const slash = $derived(repository.indexOf('/'));
	const owner = $derived(slash === -1 ? '' : repository.slice(0, slash));
	const name = $derived(slash === -1 ? repository : repository.slice(slash + 1));
</script>

<span class="inline-flex min-w-0 items-center gap-2" title={repository}>
	{#if owner}
		<img
			src="https://github.com/{encodeURIComponent(owner)}.png?size=40"
			alt={owner}
			class="size-5 shrink-0 rounded"
			loading="lazy"
		/>
	{/if}
	<span class="truncate">{name}</span>
</span>
