<script lang="ts">
	import { resolve } from '$app/paths';
	import './layout.css';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Avatar from '$lib/components/Avatar.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import { startAnalytics } from '$lib/analytics';
	import { authClient } from '$lib/auth-client';
	import { onMount } from 'svelte';
	import type { PostHog } from 'posthog-js';

	let { data, children } = $props();
	// The landing page brings its own full-width layout.
	const bare = $derived(page.url.pathname === '/');
	// Present on /app pages (from the app layout's data).
	const organizations = $derived(
		(page.data.organizations as { id: string; name: string }[] | undefined) ?? []
	);
	const activeOrganization = $derived(
		page.data.organization as { id: string; name: string } | undefined
	);
	const appSlug = $derived(page.data.appSlug as string | null | undefined);

	const tabs = [
		{
			name: 'Overview',
			href: resolve('/app'),
			match: (path: string) => path === '/app' || path.startsWith('/app/reviews')
		},
		{
			name: 'Repositories',
			href: resolve('/app/repositories'),
			match: (path: string) => path.startsWith('/app/repositories')
		},
		{
			name: 'Models',
			href: resolve('/app/settings/models'),
			match: (path: string) => path.startsWith('/app/settings/models')
		},
		{
			name: 'Learnings',
			href: resolve('/app/settings/learnings'),
			match: (path: string) => path.startsWith('/app/settings/learnings')
		},
		{
			name: 'Members',
			href: resolve('/app/settings/members'),
			match: (path: string) => path.startsWith('/app/settings/members')
		},
		{
			name: 'Settings',
			href: resolve('/app/settings/organization'),
			match: (path: string) => path.startsWith('/app/settings/organization')
		}
	];
	const menuItem =
		'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800';

	// Analytics on hansi.codes (see $lib/analytics): page views, and who is signed in.
	let posthog: PostHog | null = $state(null);
	onMount(() => {
		void startAnalytics(data.user?.id).then((client) => {
			posthog = client;
			client?.capture('$pageview');
		});
	});
	afterNavigate(({ type }) => {
		if (type !== 'enter') posthog?.capture('$pageview');
	});
	$effect(() => {
		if (!posthog) return;
		if (data.user) {
			const { id, name, email, login } = data.user;
			posthog.identify(id, { name, email, github_login: login });
		} else posthog.reset();
	});
	$effect(() => {
		if (posthog && activeOrganization) {
			posthog.group('organization', activeOrganization.id, { name: activeOrganization.name });
		}
	});

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
			<div class="mx-auto max-w-5xl px-4">
				<div class="flex h-14 items-center justify-between gap-4">
					<div class="flex min-w-0 items-center gap-2">
						<a
							href={data.user ? resolve('/app') : resolve('/')}
							class="flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight"
							aria-label="Hansi"
						>
							<Logo class="size-5" /><span class={activeOrganization ? 'hidden sm:inline' : ''}
								>Hansi</span
							>
						</a>
						{#if activeOrganization}
							<span class="text-stone-300 select-none dark:text-stone-700" aria-hidden="true"
								>/</span
							>
							<Menu
								label="Switch organization"
								class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
							>
								{#snippet trigger()}
									<Avatar name={activeOrganization.name} square class="size-6 text-xs" />
									<span class="truncate">{activeOrganization.name}</span>
									<svg
										viewBox="0 0 16 16"
										class="size-3.5 shrink-0 text-stone-400"
										aria-hidden="true"
									>
										<path
											d="M5 6.5 8 3.5l3 3M5 9.5l3 3 3-3"
											fill="none"
											stroke="currentColor"
											stroke-width="1.5"
										/>
									</svg>
								{/snippet}
								<p class="px-3 pt-2 pb-1 text-xs text-stone-500 dark:text-stone-400">
									Organizations
								</p>
								<form method="post" action="/app/organizations/switch">
									{#each organizations as organization (organization.id)}
										<button name="organizationId" value={organization.id} class={menuItem}>
											<Avatar name={organization.name} square class="size-5 text-[10px]" />
											<span class="min-w-0 flex-1 truncate">{organization.name}</span>
											{#if organization.id === activeOrganization.id}
												<svg viewBox="0 0 16 16" class="size-4 shrink-0" aria-label="Current">
													<path
														d="m3.5 8.5 3 3 6-7"
														fill="none"
														stroke="currentColor"
														stroke-width="1.75"
													/>
												</svg>
											{/if}
										</button>
									{/each}
								</form>
								<a href={resolve('/app/organizations/new')} class={menuItem}>
									<span
										class="inline-flex size-5 items-center justify-center rounded-md border border-dashed border-stone-300 text-stone-500 dark:border-stone-600"
										aria-hidden="true">+</span
									>
									New organization
								</a>
								<div class="my-1 border-t border-stone-200 dark:border-stone-800"></div>
								<a href={resolve('/app/settings/organization')} class={menuItem}>Settings</a>
								<a href={resolve('/app/settings/members')} class={menuItem}>Members</a>
							</Menu>
						{/if}
					</div>

					{#if data.user}
						<Menu
							label="Account"
							align="right"
							class="rounded-full ring-offset-2 ring-offset-white hover:ring-2 hover:ring-stone-300 dark:ring-offset-stone-950 dark:hover:ring-stone-700"
						>
							{#snippet trigger()}
								<Avatar name={data.user!.name} image={data.user!.image} class="size-8 text-sm" />
							{/snippet}
							<div class="flex items-center gap-3 px-3 py-2">
								<Avatar name={data.user.name} image={data.user.image} class="size-9 text-sm" />
								<div class="min-w-0">
									<p class="truncate font-medium">{data.user.name}</p>
									<p class="truncate text-xs text-stone-500 dark:text-stone-400">
										{data.user.login ? `@${data.user.login}` : data.user.email}
									</p>
								</div>
							</div>
							<div class="my-1 border-t border-stone-200 dark:border-stone-800"></div>
							{#if appSlug}
								<a
									href="https://github.com/apps/{appSlug}/installations/new"
									class={menuItem}
									target="_blank"
									rel="noreferrer">Add repositories</a
								>
							{/if}
							{#if data.user.login}
								<a
									href="https://github.com/{data.user.login}"
									class={menuItem}
									target="_blank"
									rel="noreferrer">GitHub profile</a
								>
							{/if}
							<div class="my-1 border-t border-stone-200 dark:border-stone-800"></div>
							<button type="button" class={menuItem} onclick={signOut}>Sign out</button>
						</Menu>
					{/if}
				</div>

				{#if data.user && activeOrganization}
					<nav class="-mb-px flex gap-1 overflow-x-auto text-sm" aria-label="Main">
						{#each tabs as tab (tab.href)}
							{@const active = tab.match(page.url.pathname)}
							<a
								href={tab.href}
								class="border-b-2 px-3 pt-1 pb-3 whitespace-nowrap {active
									? 'border-stone-900 font-medium text-stone-900 dark:border-stone-100 dark:text-stone-100'
									: 'border-transparent text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100'}"
								aria-current={active ? 'page' : undefined}>{tab.name}</a
							>
						{/each}
					</nav>
				{/if}
			</div>
		</header>

		<main class="mx-auto max-w-5xl px-4 py-8">
			{@render children()}
		</main>
	</div>
{/if}
