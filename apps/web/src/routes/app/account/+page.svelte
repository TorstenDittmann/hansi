<script lang="ts">
	import { enhance } from '$app/forms';
	import Avatar from '$lib/components/Avatar.svelte';
	import { page } from '$app/state';

	let { form } = $props();
	const user = $derived(page.data.user!);
	let confirmingDelete = $state(false);
	let confirmation = $state('');
</script>

<div class="space-y-8">
	<header class="flex items-center gap-4">
		<Avatar name={user.name} image={user.image} class="size-12 text-lg" />
		<div class="min-w-0">
			<h1 class="truncate text-2xl font-semibold">Account</h1>
			<p class="muted">
				{#if user.login}@{user.login} ·
				{/if}{user.email}
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
			<label class="font-medium" for="name">Display name</label>
			<p class="muted mb-3">Shown to teammates in this Hansi instance.</p>
			<input
				id="name"
				name="name"
				class="input max-w-sm"
				required
				maxlength="60"
				value={user.name}
			/>
		</div>
		<div
			class="flex items-center justify-end gap-3 border-t border-stone-200 bg-stone-50 px-5 py-3 dark:border-stone-800 dark:bg-stone-900/50"
		>
			{#if form && 'renamed' in form}<span class="muted">Saved</span>{/if}
			<button class="btn btn-primary">Save</button>
		</div>
	</form>

	<section class="card divide-y divide-stone-200 dark:divide-stone-800">
		<div class="flex flex-wrap items-center justify-between gap-4 p-5">
			<div>
				<p class="font-medium">Email</p>
				<p class="muted">From your GitHub account. Change it on GitHub, then sign in again.</p>
			</div>
			<p class="text-sm">{user.email}</p>
		</div>
		{#if user.login}
			<div class="flex flex-wrap items-center justify-between gap-4 p-5">
				<div>
					<p class="font-medium">GitHub</p>
					<p class="muted">Used to sign in and install the app on repositories.</p>
				</div>
				<a
					href="https://github.com/{user.login}"
					class="text-sm font-medium hover:underline"
					target="_blank"
					rel="noreferrer">@{user.login}</a
				>
			</div>
		{/if}
	</section>

	<section class="card">
		<form method="post" action="?/delete" use:enhance class="space-y-4 p-5">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<div class="max-w-xl">
					<p class="font-medium text-red-700 dark:text-red-400">Delete account</p>
					<p class="muted">
						Removes your user and any organizations you belong to alone. Organizations you share
						with others are left intact if another owner remains.
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
						Type <strong>{user.email}</strong> to confirm
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
							disabled={confirmation !== user.email}>Delete forever</button
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
	</section>
</div>
