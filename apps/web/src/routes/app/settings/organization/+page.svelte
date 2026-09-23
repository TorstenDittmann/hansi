<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const isOwner = $derived(data.role.split(',').includes('owner'));
</script>

<div class="space-y-10">
	<header>
		<h1 class="text-2xl font-semibold">Organization</h1>
		<p class="muted">Settings for {data.organization.name}.</p>
	</header>

	{#if form?.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
		>
			{form.error}
		</div>
	{:else if form && 'renamed' in form}
		<p class="muted">Saved.</p>
	{/if}

	<form method="post" action="?/rename" use:enhance class="card space-y-3 p-4">
		<label class="label" for="name">Name</label>
		<div class="flex gap-3">
			<input
				id="name"
				name="name"
				class="input"
				required
				maxlength="60"
				value={data.organization.name}
			/>
			<button class="btn btn-primary">Save</button>
		</div>
	</form>

	<section class="card space-y-4 border-red-200 p-4 dark:border-red-900">
		<h2 class="font-semibold">Danger zone</h2>
		{#if !isOwner || data.memberCount > 1}
			<form
				method="post"
				action="?/leave"
				use:enhance
				class="flex items-center justify-between gap-4"
			>
				<p class="muted">Leave {data.organization.name}. You'll lose access to its reviews.</p>
				<button class="btn btn-danger shrink-0">Leave</button>
			</form>
		{/if}
		{#if isOwner}
			<form method="post" action="?/delete" use:enhance class="space-y-3">
				<p class="muted">
					Delete {data.organization.name} with its model keys, reviews, and learnings. Its GitHub installations
					are released so another organization can claim them. This cannot be undone.
				</p>
				<div class="flex gap-3">
					<input
						name="confirm"
						class="input"
						autocomplete="off"
						placeholder={`Type "${data.organization.name}" to confirm`}
						aria-label="Organization name, to confirm"
					/>
					<button class="btn btn-danger shrink-0">Delete organization</button>
				</div>
			</form>
		{/if}
	</section>
</div>
