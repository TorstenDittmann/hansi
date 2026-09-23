<script lang="ts">
	import { resolve } from '$app/paths';
	import './layout.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import { authClient } from '$lib/auth-client';

	let { data, children } = $props();
	// The landing page brings its own full-width layout.
	const bare = $derived(page.url.pathname === '/');

	async function signOut() {
		await authClient.signOut();
		await goto(resolve('/'), { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>Hansi</title>
	<link rel="icon" href={favicon} type="image/svg+xml" />
</svelte:head>

{#if bare}
	{@render children()}
{:else}
	<div class="min-h-screen">
		<header class="border-b border-stone-200 dark:border-stone-800">
			<div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
				<a
					href={data.user ? resolve('/app') : resolve('/')}
					class="flex items-baseline gap-2 text-lg font-bold tracking-tight"
				>
					Hansi<span
						class="font-mono text-sm font-medium text-stone-400 [font-variant-ligatures:none]"
						aria-hidden="true">=^.^=</span
					>
				</a>
				{#if data.user}
					<nav class="flex items-center gap-4 text-sm">
						<a href={resolve('/app')} class="hover:underline">Overview</a>
						<a href={resolve('/app/settings/models')} class="hover:underline">Models</a>
						<a href={resolve('/app/settings/learnings')} class="hover:underline">Learnings</a>
						<a href={resolve('/app/settings/members')} class="hover:underline">Members</a>
						<span class="muted hidden sm:inline">{data.user.name}</span>
						<button type="button" class="btn" onclick={signOut}>Sign out</button>
					</nav>
				{/if}
			</div>
		</header>

		<main class="mx-auto max-w-5xl px-4 py-8">
			{@render children()}
		</main>
	</div>
{/if}
