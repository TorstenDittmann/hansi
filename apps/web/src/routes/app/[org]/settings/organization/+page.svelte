<script lang="ts">
	import { enhance } from '$app/forms';
	import Avatar from '$lib/components/Avatar.svelte';

	let { data, form } = $props();
	const isOwner = $derived(data.role.split(',').includes('owner'));
	const canLeave = $derived(!isOwner || data.memberCount > 1);
	let confirmingDelete = $state(false);
	let confirmation = $state('');
</script>

<div class="space-y-8">
	<header class="flex items-center gap-4">
		<Avatar name={data.organization.name} square class="size-12 text-lg" />
		<div class="min-w-0">
			<h1 class="truncate text-2xl font-semibold">{data.organization.name}</h1>
			<p class="muted">
				{data.memberCount}
				{data.memberCount === 1 ? 'member' : 'members'} · you are {isOwner
					? 'an owner'
					: 'a member'}
			</p>
		</div>
	</header>

	{#if form?.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	<form method="post" action="?/rename" use:enhance class="card overflow-hidden">
		<div class="p-5">
			<label class="font-medium" for="name">Name</label>
			<input
				id="name"
				name="name"
				class="input mt-3 max-w-sm"
				required
				maxlength="60"
				value={data.organization.name}
			/>
		</div>
		<div
			class="flex items-center justify-end gap-3 border-t border-stone-200 bg-stone-50 px-5 py-3 dark:border-stone-800 dark:bg-stone-900/50"
		>
			{#if form && 'renamed' in form}<span class="muted">Saved</span>{/if}
			<button class="btn btn-primary">Save</button>
		</div>
	</form>

	{#if canLeave || isOwner}
		<section class="card divide-y divide-stone-200 dark:divide-stone-800">
			{#if canLeave}
				<form
					method="post"
					action="?/leave"
					use:enhance
					class="flex flex-wrap items-center justify-between gap-4 p-5"
				>
					<div>
						<p class="font-medium">Leave organization</p>
						<p class="muted">You'll lose access to its reviews and settings.</p>
					</div>
					<button class="btn btn-danger">Leave</button>
				</form>
			{/if}
			{#if isOwner}
				<form method="post" action="?/delete" use:enhance class="space-y-4 p-5">
					<div class="flex flex-wrap items-center justify-between gap-4">
						<div class="max-w-xl">
							<p class="font-medium text-red-700 dark:text-red-400">Delete organization</p>
							<p class="muted">
								Removes its model keys, reviews, and learnings, and releases its GitHub
								installations so another organization can claim them. This cannot be undone.
							</p>
						</div>
						{#if !confirmingDelete}
							<button type="button" class="btn btn-danger" onclick={() => (confirmingDelete = true)}
								>Delete…</button
							>
						{/if}
					</div>
					{#if confirmingDelete}
						<div class="rounded-md bg-red-50 p-4 dark:bg-red-950/40">
							<label class="label" for="confirm">
								Type <strong>{data.organization.name}</strong> to confirm
							</label>
							<div class="flex flex-wrap gap-2">
								<!-- svelte-ignore a11y_autofocus -->
								<input
									id="confirm"
									name="confirm"
									class="input max-w-sm"
									autocomplete="off"
									bind:value={confirmation}
									autofocus
								/>
								<button
									class="btn border-transparent bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700"
									disabled={confirmation !== data.organization.name}>Delete forever</button
								>
								<button
									type="button"
									class="btn"
									onclick={() => {
										confirmingDelete = false;
										confirmation = '';
									}}>Cancel</button
								>
							</div>
						</div>
					{/if}
				</form>
			{/if}
		</section>
	{/if}
</div>
