<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TierBadge from '$lib/components/TierBadge.svelte';
	import { formatCost, formatDate, verdictLabel } from '$lib/format';

	let { data, form } = $props();
	let syncing = $state(false);
</script>

<div class="space-y-10">
	<section>
		<div class="flex flex-wrap items-center justify-between gap-3">
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
					<button class="btn" disabled={syncing}
						>{syncing ? 'Syncing…' : 'Sync installations'}</button
					>
				</form>
				{#if data.appSlug}
					<a
						class="btn btn-primary"
						href="https://github.com/apps/{data.appSlug}/installations/new"
					>
						Add repositories
					</a>
				{/if}
			</div>
		</div>

		{#if form && 'synced' in form}
			<p class="muted mt-3">Synced {form.synced} installation{form.synced === 1 ? '' : 's'}.</p>
		{:else if form?.message}
			<p class="mt-3 text-sm text-red-600">{form.message}</p>
		{/if}

		{#if data.repositories.length === 0}
			<div class="card mt-4 p-6 text-center">
				<p>No repositories yet.</p>
				<p class="muted mt-1">
					Install the GitHub App on an account, then come back here. Already installed? Use “Sync
					installations”.
				</p>
			</div>
		{:else}
			<ul class="card mt-4 divide-y divide-stone-200 dark:divide-stone-800">
				{#each data.repositories as repo (repo.id)}
					<li class="flex items-center justify-between px-4 py-3">
						<div class="flex items-center gap-2">
							<span class="font-mono text-sm">{repo.fullName}</span>
							{#if repo.private}<span class="badge bg-stone-100 dark:bg-stone-800">private</span
								>{/if}
							{#if repo.suspended}<span class="badge bg-amber-100 text-amber-800">suspended</span
								>{/if}
						</div>
						<form method="post" action="?/toggle" use:enhance>
							<input type="hidden" name="repositoryId" value={repo.id} />
							<input type="hidden" name="enabled" value={String(!repo.enabled)} />
							<button class="btn">{repo.enabled ? 'Disable' : 'Enable'}</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h2 class="text-xl font-semibold">Recent reviews</h2>
		{#if data.reviews.length === 0}
			<p class="muted mt-2">
				Reviews appear here when a pull request is opened or someone comments
				<code>@{data.appSlug ?? 'hansi'} review</code>.
			</p>
		{:else}
			<div class="card mt-4 overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-stone-200 text-stone-500 dark:border-stone-800">
						<tr>
							<th class="px-4 py-2 font-medium">Pull request</th>
							<th class="px-4 py-2 font-medium">Tier</th>
							<th class="px-4 py-2 font-medium">Status</th>
							<th class="px-4 py-2 font-medium">Comments</th>
							<th class="px-4 py-2 font-medium">Cost</th>
							<th class="px-4 py-2 font-medium">Created</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-200 dark:divide-stone-800">
						{#each data.reviews as review (review.id)}
							<tr class="hover:bg-stone-50 dark:hover:bg-stone-800/50">
								<td class="px-4 py-2">
									<a
										class="font-mono hover:underline"
										href={resolve('/app/reviews/[id]', { id: review.id })}
									>
										{review.repository}#{review.pullNumber}
									</a>
								</td>
								<td class="px-4 py-2"><TierBadge tier={review.tier} /></td>
								<td class="px-4 py-2">
									{#if review.status === 'completed' && review.verdict}
										{verdictLabel[review.verdict]}
									{:else}
										<StatusBadge status={review.status} />
									{/if}
								</td>
								<td class="px-4 py-2">{review.posted}</td>
								<td class="px-4 py-2">{formatCost(review.costUsd)}</td>
								<td class="muted px-4 py-2">{formatDate(review.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
