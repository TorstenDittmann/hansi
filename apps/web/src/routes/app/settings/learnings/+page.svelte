<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/format';

	let { data, form } = $props();
</script>

<div class="space-y-10">
	<header>
		<h1 class="text-2xl font-semibold">Learnings</h1>
	</header>

	{#if form?.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
		>
			{form.error}
		</div>
	{/if}

	<form method="post" action="?/add" use:enhance class="card space-y-3 p-4">
		<label class="label" for="body">New rule</label>
		<textarea
			id="body"
			name="body"
			rows="2"
			maxlength="500"
			required
			class="input"
			placeholder="Don't flag missing error handling in scripts/."></textarea>
		<div class="flex flex-wrap items-center gap-3">
			<select name="repositoryId" class="input w-auto" aria-label="Scope">
				<option value="">All repositories</option>
				{#each data.repositories as repository (repository.id)}
					<option value={repository.id}>{repository.fullName}</option>
				{/each}
			</select>
			<button class="btn btn-primary">Add rule</button>
		</div>
	</form>

	{#if data.learnings.length === 0}
		<p class="muted">No learnings yet.</p>
	{:else}
		<ul class="card divide-y divide-stone-200 dark:divide-stone-800">
			{#each data.learnings as learning (learning.id)}
				<li class="flex items-start justify-between gap-4 px-4 py-3">
					<div>
						<p>{learning.body}</p>
						<p class="muted mt-1">
							{learning.repository ?? 'All repositories'}
							{#if learning.author}· by {learning.author}{/if}
							· {formatDate(learning.createdAt)}
							{#if learning.sourceUrl}
								· <a class="underline" href={learning.sourceUrl}>source</a>
							{/if}
						</p>
					</div>
					<form method="post" action="?/delete" use:enhance>
						<input type="hidden" name="learningId" value={learning.id} />
						<button class="btn btn-danger">Delete</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</div>
