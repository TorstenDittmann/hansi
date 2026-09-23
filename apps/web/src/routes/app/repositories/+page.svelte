<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	let { data, form } = $props();
	let syncing = $state(false);
	let query = $state('');
	let filter: 'all' | 'enabled' | 'disabled' = $state('all');

	const enabledCount = $derived(data.repositories.filter((repo) => repo.enabled).length);
	const counts = $derived({
		all: data.repositories.length,
		enabled: enabledCount,
		disabled: data.repositories.length - enabledCount
	});
	/** A search or filter is active, so bulk actions apply to what is shown, not everything. */
	const narrowed = $derived(filter !== 'all' || query.trim() !== '');
	const shown = $derived(
		data.repositories.filter(
			(repo) =>
				(filter === 'all' || repo.enabled === (filter === 'enabled')) &&
				repo.fullName.toLowerCase().includes(query.trim().toLowerCase())
		)
	);
</script>

<div class="space-y-6">
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">Repositories</h1>
			<p class="muted">Pull requests in enabled repositories are reviewed automatically.</p>
		</div>
		<div class="flex gap-2">
			<form
				method="post"
				action="?/sync"
				use:enhance={() => {
					syncing = true;
					return async ({ update }) => {
						await update();
						syncing = false;
					};
				}}
			>
				<button class="btn" disabled={syncing}>{syncing ? 'Syncing…' : 'Sync installations'}</button
				>
			</form>
			{#if data.appSlug}
				<a
					class="btn btn-primary"
					href="https://github.com/apps/{data.appSlug}/installations/new"
					target="_blank"
					rel="noreferrer">Add repositories</a
				>
			{/if}
		</div>
	</header>

	{#if form && 'synced' in form}
		<p class="muted">
			Synced {form.synced} installation{form.synced === 1 ? '' : 's'}.
			{#if form.elsewhere}
				{form.elsewhere} other{form.elsewhere === 1 ? ' belongs' : 's belong'} to another organization;
				disconnect {form.elsewhere === 1 ? 'it' : 'them'} there to move {form.elsewhere === 1
					? 'it'
					: 'them'} here.
			{/if}
		</p>
	{:else if form?.message}
		<p class="text-sm text-red-600 dark:text-red-400" role="alert">{form.message}</p>
	{:else if page.url.searchParams.has('elsewhere')}
		<p
			class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
			role="status"
		>
			That installation belongs to another organization. Disconnect it there to move it here.
		</p>
	{/if}

	{#if data.installations.length}
		<section class="flex flex-wrap items-center gap-2" aria-label="Installations">
			<span class="muted">Installed on</span>
			{#each data.installations as installation (installation.id)}
				<form
					method="post"
					action="?/disconnect"
					use:enhance={({ cancel }) => {
						if (
							!confirm(
								`Disconnect ${installation.accountLogin}? Its repositories stop being reviewed here until an organization syncs it again.`
							)
						)
							cancel();
					}}
					class="flex items-center gap-1.5 rounded-full border border-stone-200 py-0.5 pr-1 pl-1 text-sm dark:border-stone-800"
				>
					<img
						src="https://github.com/{installation.accountLogin}.png?size=40"
						alt=""
						class="size-5 {installation.accountType === 'Organization'
							? 'rounded'
							: 'rounded-full'}"
					/>
					<span class="font-medium">{installation.accountLogin}</span>
					<input type="hidden" name="installationId" value={installation.id} />
					<button
						class="rounded-full px-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-700 dark:hover:bg-stone-800 dark:hover:text-red-400"
						aria-label="Disconnect {installation.accountLogin}"
						title="Disconnect">×</button
					>
				</form>
			{/each}
		</section>
	{/if}

	{#if data.repositories.length === 0}
		<div class="card p-8 text-center">
			<p class="font-medium">No repositories yet</p>
			<p class="muted mt-1">
				Install the GitHub App on an account or organization. Already installed? Use “Sync
				installations”.
			</p>
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-3">
			<input
				class="input max-w-xs"
				type="search"
				placeholder="Search repositories"
				aria-label="Search repositories"
				bind:value={query}
			/>
			<div
				class="inline-flex rounded-md border border-stone-200 p-0.5 text-sm dark:border-stone-800"
				role="group"
				aria-label="Show"
			>
				{#each ['all', 'enabled', 'disabled'] as const as option (option)}
					<button
						type="button"
						class="rounded px-3 py-1 capitalize {filter === option
							? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
							: 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}"
						aria-pressed={filter === option}
						onclick={() => (filter = option)}
						>{option} <span class="tabular-nums opacity-60">{counts[option]}</span></button
					>
				{/each}
			</div>
			<div class="ml-auto flex gap-2">
				{#each [true, false] as enable (enable)}
					{@const targets = shown.filter((repo) => repo.enabled !== enable)}
					<form method="post" action="?/toggle" use:enhance>
						{#each targets as repo (repo.id)}
							<input type="hidden" name="repositoryId" value={repo.id} />
						{/each}
						<input type="hidden" name="enabled" value={String(enable)} />
						<button class="btn" disabled={targets.length === 0}>
							{enable ? 'Enable' : 'Disable'}
							{narrowed ? `${shown.length} shown` : 'all'}
						</button>
					</form>
				{/each}
			</div>
		</div>

		<ul class="card divide-y divide-stone-200 dark:divide-stone-800">
			{#each shown as repo (repo.id)}
				{@const [owner, name] = repo.fullName.split('/')}
				<li class="flex items-center justify-between gap-3 px-4 py-3">
					<div class="flex min-w-0 items-center gap-2">
						<span
							class="size-2 shrink-0 rounded-full {repo.enabled
								? 'bg-emerald-500'
								: 'bg-stone-300 dark:bg-stone-600'}"
							aria-hidden="true"
						></span>
						<a
							href="https://github.com/{repo.fullName}"
							target="_blank"
							rel="noreferrer"
							class="min-w-0 truncate font-mono text-sm hover:underline"
							><span class="text-stone-500 dark:text-stone-400">{owner}/</span>{name}</a
						>
						{#if repo.private}<span class="badge bg-stone-100 dark:bg-stone-800">private</span>{/if}
						{#if repo.suspended}<span
								class="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
								>suspended</span
							>{/if}
					</div>
					<form
						method="post"
						action="?/toggle"
						use:enhance
						class="flex shrink-0 items-center gap-3"
					>
						<span class="muted hidden sm:inline">{repo.enabled ? 'Reviewing' : 'Off'}</span>
						<input type="hidden" name="repositoryId" value={repo.id} />
						<input type="hidden" name="enabled" value={String(!repo.enabled)} />
						<button
							class="relative h-5 w-9 rounded-full transition-colors {repo.enabled
								? 'bg-stone-900 dark:bg-stone-100'
								: 'bg-stone-300 dark:bg-stone-700'}"
							role="switch"
							aria-checked={repo.enabled}
							aria-label="Review pull requests in {repo.fullName}"
						>
							<span
								class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform dark:bg-stone-900 {repo.enabled
									? 'translate-x-4'
									: ''}"
							></span>
						</button>
					</form>
				</li>
			{:else}
				<li class="muted px-4 py-6 text-center">No repositories match.</li>
			{/each}
		</ul>
	{/if}
</div>
