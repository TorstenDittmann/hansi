<script lang="ts">
	import { authClient } from '$lib/auth-client';

	let { data } = $props();
	let pending = $state(false);
	// Starts from an OAuth error in the URL; overwritten by client-side failures.
	let error = $derived<string | null>(data.error);

	async function signIn() {
		pending = true;
		error = null;
		const result = await authClient.signIn.social({
			provider: 'github',
			callbackURL: data.destination,
			errorCallbackURL: '/login'
		});
		if (result.error) {
			error = result.error.message ?? 'Sign-in failed';
			pending = false;
		}
	}
</script>

<div class="card mx-auto mt-16 max-w-sm p-6">
	<h1 class="text-xl font-semibold">Sign in</h1>
	<p class="muted mt-1">Use your GitHub account to continue.</p>
	<button type="button" class="btn btn-primary mt-6 w-full" disabled={pending} onclick={signIn}>
		{pending ? 'Redirecting…' : 'Continue with GitHub'}
	</button>
	{#if error}
		<p class="mt-3 text-sm text-red-600">{error}</p>
	{/if}
</div>
