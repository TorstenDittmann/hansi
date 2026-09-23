<script lang="ts">
	import { resolve } from '$app/paths';
	let { data } = $props();
</script>

<section class="mx-auto max-w-2xl py-16">
	<h1 class="text-4xl font-semibold tracking-tight">AI code review you can host yourself.</h1>
	<p class="mt-4 text-lg text-stone-600 dark:text-stone-400">
		hans reviews your pull requests with the model and API key you choose. It checks its own
		findings before posting, so you get fewer, better comments.
	</p>
	<div class="mt-8 flex gap-3">
		{#if data.configured}
			<a href={resolve('/login')} class="btn btn-primary">Sign in with GitHub</a>
		{:else}
			<a href={resolve('/setup')} class="btn btn-primary">Set up this instance</a>
		{/if}
	</div>
</section>
