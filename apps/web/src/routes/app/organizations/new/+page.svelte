<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<div class="mx-auto max-w-md">
	<h1 class="text-2xl font-semibold">New organization</h1>

	<form method="post" use:enhance class="card mt-6 space-y-4 p-6">
		<div>
			<label class="label" for="name">Name</label>
			<input
				id="name"
				name="name"
				class="input"
				required
				maxlength="60"
				placeholder="Acme"
				value={form?.name ?? ''}
			/>
		</div>
		{#if form?.error}
			<p class="text-sm text-red-600 dark:text-red-400">{form.error}</p>
		{/if}
		<button class="btn btn-primary">Create organization</button>
	</form>
</div>
