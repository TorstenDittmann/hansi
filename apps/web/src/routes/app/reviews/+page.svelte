<script lang="ts">
	import { resolve } from '$app/paths';
	import ReviewsTable from '$lib/components/ReviewsTable.svelte';
	import { reviewSearch } from '$lib/reviews';

	let { data } = $props();

	const filtered = $derived(Boolean(data.query || data.repository || data.status));
	const showFilters = $derived(data.repositories.length > 0 || filtered);
	const showRepository = $derived(data.repositories.length > 1 || Boolean(data.repository));

	/**
	 * Blank controls still have names, so a GET form would put `repo=` and `status=` in the
	 * URL. Disable them before SvelteKit builds `FormData` from the bubbling `submit` event.
	 * Capturing runs first; the fields are restored on the next task.
	 */
	function omitBlankFields(event: SubmitEvent) {
		const form = event.currentTarget;
		if (!(form instanceof HTMLFormElement)) return;

		const blank: Array<HTMLInputElement | HTMLSelectElement> = [];
		for (const field of form.elements) {
			if (
				(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) &&
				field.name &&
				!field.disabled &&
				field.value.trim() === ''
			) {
				field.disabled = true;
				blank.push(field);
			}
		}
		setTimeout(() => {
			for (const field of blank) field.disabled = false;
		});
	}
</script>

<div class="space-y-6">
	<header>
		<h1 class="text-2xl font-semibold">Reviews</h1>
	</header>

	{#if showFilters}
		<form
			class="flex flex-wrap items-center gap-3"
			method="GET"
			action={resolve('/app/reviews')}
			onsubmitcapture={omitBlankFields}
		>
			<input
				class="input max-w-xs"
				type="search"
				name="q"
				value={data.query}
				placeholder="Repository or pull request"
				aria-label="Search reviews"
			/>
			{#if showRepository}
				<select
					class="input w-auto max-w-xs"
					name="repo"
					aria-label="Repository"
					value={data.repository}
					onchange={(event) => event.currentTarget.form?.requestSubmit()}
				>
					<option value="">All repositories</option>
					{#each data.repositories as repository (repository)}
						<option value={repository}>{repository}</option>
					{/each}
					{#if data.repository && !data.repositories.includes(data.repository)}
						<option value={data.repository}>{data.repository}</option>
					{/if}
				</select>
			{/if}
			<select
				class="input w-auto capitalize"
				name="status"
				aria-label="Status"
				value={data.status}
				onchange={(event) => event.currentTarget.form?.requestSubmit()}
			>
				<option value="">All statuses</option>
				{#each data.statuses as status (status)}
					<option value={status}>{status}</option>
				{/each}
			</select>
			<button class="btn">Search</button>
			{#if filtered}
				<a href={resolve('/app/reviews')} class="muted hover:underline">Clear</a>
			{/if}
			<p class="muted sm:ml-auto">
				{data.total} review{data.total === 1 ? '' : 's'}
			</p>
		</form>
	{/if}

	{#if data.reviews.length === 0}
		<div class="card p-8 text-center">
			{#if filtered}
				<p class="font-medium">No reviews match</p>
				<p class="muted mt-1">Try a different repository, status, or pull request.</p>
			{:else}
				<p class="font-medium">No reviews yet</p>
				<p class="muted mt-1">
					Reviews appear here when a pull request is opened or someone comments
					<code>@{data.appSlug ?? 'hansi'} review</code>.
				</p>
			{/if}
		</div>
	{:else}
		<ReviewsTable reviews={data.reviews} showTrigger />
		{#if data.pages > 1}
			<nav class="flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
				<p class="muted">Page {data.page} of {data.pages}</p>
				<div class="flex gap-2">
					{#if data.page > 1}
						{@const search = reviewSearch({
							query: data.query,
							repository: data.repository,
							status: data.status,
							page: data.page - 1
						})}
						<a class="btn" href="{resolve('/app/reviews')}{search}">Previous</a>
					{:else}
						<span class="btn pointer-events-none opacity-50" aria-disabled="true">Previous</span>
					{/if}
					{#if data.page < data.pages}
						{@const search = reviewSearch({
							query: data.query,
							repository: data.repository,
							status: data.status,
							page: data.page + 1
						})}
						<a class="btn" href="{resolve('/app/reviews')}{search}">Next</a>
					{:else}
						<span class="btn pointer-events-none opacity-50" aria-disabled="true">Next</span>
					{/if}
				</div>
			</nav>
		{/if}
	{/if}
</div>
