<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import './layout.css';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Avatar from '$lib/components/Avatar.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { identifyAnalyticsUser, resetAnalyticsIdentity, startAnalytics } from '$lib/analytics';
	import { startThemeSync } from '$lib/theme-client.svelte';
	import { authClient } from '$lib/auth-client';
	import {
		DEFAULT_DESCRIPTION,
		OG_IMAGE_HEIGHT,
		OG_IMAGE_PATH,
		OG_IMAGE_WIDTH,
		SITE_NAME,
		SITE_ORIGIN,
		absoluteUrl,
		isIndexablePath
	} from '$lib/seo';
	import { onMount } from 'svelte';
	import type { PostHog } from 'posthog-js';

	let { data, children } = $props();
	// The landing page brings its own full-width layout.
	const bare = $derived(page.url.pathname === '/');
	// Present on /app pages (from the app layout's data).
	const organizations = $derived(page.data.organizations ?? []);
	const activeOrganization = $derived(page.data.organization);
	const appSlug = $derived(page.data.appSlug);
	// The organization in the URL, or the active one on pages that are not org-scoped.
	const org = $derived(page.params.org ?? activeOrganization?.slug ?? '');
	// Pages override title/description by returning them from `load` (see $lib/seo).
	const title = $derived(page.data.title ?? SITE_NAME);
	const description = $derived(page.data.description ?? DEFAULT_DESCRIPTION);
	const canonical = $derived(absoluteUrl(page.url.pathname));
	const ogImage = $derived(`${SITE_ORIGIN}${OG_IMAGE_PATH}`);
	const indexable = $derived(isIndexablePath(page.url.pathname));

	const tabs = $derived(
		org
			? [
					{
						name: 'Overview',
						href: resolve('/app/[org]', { org }),
						match: (path: string) => sectionMatches(path, org, '')
					},
					{
						name: 'Reviews',
						href: resolve('/app/[org]/reviews', { org }),
						match: (path: string) => sectionMatches(path, org, 'reviews')
					},
					{
						name: 'Repositories',
						href: resolve('/app/[org]/repositories', { org }),
						match: (path: string) => sectionMatches(path, org, 'repositories')
					},
					{
						name: 'Models',
						href: resolve('/app/[org]/settings/models', { org }),
						match: (path: string) => sectionMatches(path, org, 'settings/models')
					},
					{
						name: 'Learnings',
						href: resolve('/app/[org]/settings/learnings', { org }),
						match: (path: string) => sectionMatches(path, org, 'settings/learnings')
					},
					{
						name: 'Integration',
						href: resolve('/app/[org]/integration', { org }),
						match: (path: string) => sectionMatches(path, org, 'integration')
					},
					{
						name: 'Members',
						href: resolve('/app/[org]/settings/members', { org }),
						match: (path: string) => sectionMatches(path, org, 'settings/members')
					},
					{
						name: 'Settings',
						href: resolve('/app/[org]/settings/organization', { org }),
						match: (path: string) => sectionMatches(path, org, 'settings/organization')
					}
				]
			: []
	);

	/** The path after `/app/<slug>/`, or `''` on the organization overview. */
	function organizationSection(path: string, slug: string) {
		for (const prefix of [`/app/${encodeURIComponent(slug)}`, `/app/${slug}`]) {
			if (path === prefix) return '';
			if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length + 1);
		}
		return null;
	}

	function sectionMatches(path: string, slug: string, section: string) {
		const rest = organizationSection(path, slug);
		if (rest === null) return false;
		if (!section) return rest === '';
		return rest === section || rest.startsWith(`${section}/`);
	}

	/** The same page under another organization, or that organization's overview. */
	function hrefInOrganization(slug: string): ResolvedPathname {
		const search = page.url.search;
		const keep = (path: ResolvedPathname) =>
			(search ? `${path}${search}` : path) as ResolvedPathname;
		const reviewId = page.params.id ?? '';
		switch (page.route.id) {
			case '/app/[org]/reviews':
				return keep(resolve('/app/[org]/reviews', { org: slug }));
			case '/app/[org]/reviews/[id]':
				return keep(resolve('/app/[org]/reviews/[id]', { org: slug, id: reviewId }));
			case '/app/[org]/repositories':
				return keep(resolve('/app/[org]/repositories', { org: slug }));
			case '/app/[org]/settings/models':
				return keep(resolve('/app/[org]/settings/models', { org: slug }));
			case '/app/[org]/settings/learnings':
				return keep(resolve('/app/[org]/settings/learnings', { org: slug }));
			case '/app/[org]/settings/members':
				return keep(resolve('/app/[org]/settings/members', { org: slug }));
			case '/app/[org]/settings/organization':
				return keep(resolve('/app/[org]/settings/organization', { org: slug }));
			case '/app/[org]/integration':
				return keep(resolve('/app/[org]/integration', { org: slug }));
			default:
				return resolve('/app/[org]', { org: slug });
		}
	}
	const menuItem =
		'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800';

	// Analytics on hansi.codes (see $lib/analytics): page views, and who is signed in.
	// The client stays off $state so its methods keep their own `this`.
	let posthog: PostHog | null = null;
	let analyticsReady = $state(false);
	let signedIn = false;
	onMount(() => startThemeSync());
	onMount(() => {
		// The user the client is bootstrapped with, even if they sign out before it loads.
		const user = data.user;
		void startAnalytics(user).then((client) => {
			posthog = client;
			signedIn = !!user;
			analyticsReady = true;
			client?.capture('$pageview');
		});
	});
	afterNavigate(({ type }) => {
		if (type !== 'enter') posthog?.capture('$pageview');
	});
	$effect(() => {
		if (!analyticsReady || !posthog) return;
		const user = data.user;
		if (user) {
			identifyAnalyticsUser(posthog, user);
			signedIn = true;
		} else if (signedIn) {
			resetAnalyticsIdentity(posthog);
			signedIn = false;
		}
	});
	$effect(() => {
		if (analyticsReady && posthog && activeOrganization) {
			posthog.group('organization', activeOrganization.id, { name: activeOrganization.name });
		}
	});

	async function signOut() {
		await authClient.signOut();
		await goto(resolve('/'), { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	{#if !indexable}
		<meta name="robots" content="noindex, nofollow" />
	{/if}
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
	<meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={ogImage} />
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
							href={data.user && org ? resolve('/app/[org]', { org }) : resolve('/')}
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
								{#each organizations as organization (organization.id)}
									<a href={hrefInOrganization(organization.slug)} class={menuItem}>
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
									</a>
								{/each}
								<a href={resolve('/app/organizations/new')} class={menuItem}>
									<span
										class="inline-flex size-5 items-center justify-center rounded-md border border-dashed border-stone-300 text-stone-500 dark:border-stone-600"
										aria-hidden="true">+</span
									>
									New organization
								</a>
								<div class="my-1 border-t border-stone-200 dark:border-stone-800"></div>
								<a href={resolve('/app/[org]/settings/organization', { org })} class={menuItem}
									>Settings</a
								>
								<a href={resolve('/app/[org]/settings/members', { org })} class={menuItem}
									>Members</a
								>
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
							<a href={resolve('/app/account')} class={menuItem}>Account settings</a>
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
							<ThemeToggle />
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
