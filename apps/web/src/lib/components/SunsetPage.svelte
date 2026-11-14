<script lang="ts">
	import { resolve } from '$app/paths';
	import '@fontsource-variable/martian-mono';
	import AsciiHansi from '$lib/components/AsciiHansi.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { formatSunsetDate } from '$lib/sunset';

	/** `organization` is the slug of the signed-in person's organization, for a dashboard link. */
	let { date, organization }: { date: string; organization: string | null } = $props();

	const day = $derived(formatSunsetDate(date));

	const repo = 'https://github.com/TorstenDittmann/hansi';
	const selfHostGuide = 'https://github.com/TorstenDittmann/hansi/blob/main/SELFHOST.md';

	const steps = [
		{ comment: '# Get the code', command: `git clone ${repo}.git && cd hansi` },
		{ comment: '# Set APP_URL and two secrets', command: 'cp .env.example .env' },
		{ comment: '# Start the web app and the worker', command: 'cd docker && docker compose up -d' }
	];

	const selfHostFacts = [
		{
			title: 'One Docker image',
			text: 'The web app and the worker ship in the same image, with a libSQL file for the database. No Redis, no Postgres.'
		},
		{
			title: 'Your GitHub App',
			text: 'The setup page creates a GitHub App for your instance in a few clicks, so reviews come from your own bot.'
		},
		{
			title: 'Your model key',
			text: 'Same as today: OpenAI, Anthropic, Amazon Bedrock, Google, xAI, OpenRouter, Cerebras, or any OpenAI-compatible endpoint.'
		},
		{
			title: 'MIT-licensed',
			text: 'Every feature from hansi.codes is in the repository. Nothing was held back for the hosted version.'
		}
	];

	const focus =
		'rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-400';
	const button = `inline-flex items-center justify-center rounded-[0.6rem] bg-stone-900 dark:bg-stone-100 font-semibold text-white dark:text-stone-900 transition-colors hover:bg-stone-700 dark:hover:bg-stone-300 motion-reduce:transition-none ${focus}`;
	const secondaryButton = `inline-flex items-center justify-center rounded-[0.6rem] border border-stone-300 dark:border-stone-700 font-semibold transition-colors hover:bg-stone-100 dark:hover:bg-stone-900 motion-reduce:transition-none ${focus}`;
	const navLink = `font-medium text-stone-500 dark:text-stone-400 transition-colors hover:text-stone-900 dark:hover:text-stone-100 motion-reduce:transition-none ${focus}`;
	const sectionTitle =
		'font-display text-2xl font-bold tracking-[-0.04em] text-balance sm:text-[2rem] sm:leading-[1.15]';
</script>

{#snippet githubIcon()}
	<svg viewBox="0 0 16 16" class="size-4" fill="currentColor" aria-hidden="true">
		<path
			d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
		/>
	</svg>
{/snippet}

<div
	class="min-h-screen bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100"
>
	<header class="mx-auto flex h-18 max-w-[70rem] items-center justify-between px-4 sm:px-6">
		<a
			href={resolve('/')}
			class="flex items-center gap-2.5 font-display text-xl font-bold tracking-[-0.04em] {focus}"
		>
			<Logo class="size-6" />Hansi
		</a>
		<nav aria-label="Main" class="flex items-center gap-7">
			<a href="#self-host" class="hidden sm:inline {navLink}">Self-host</a>
			<a href="#next" class="hidden sm:inline {navLink}">What's next</a>
			{#if organization}
				<a href={resolve('/app/[org]', { org: organization })} class="px-4 py-2 text-sm {button}"
					>Open dashboard</a
				>
			{:else}
				<a href={resolve('/login')} class={navLink}>Sign in</a>
			{/if}
		</nav>
	</header>

	<main class="mx-auto max-w-[70rem] px-4 sm:px-6">
		<section
			class="relative pt-12 pb-10 sm:pt-20 sm:pb-14 lg:flex lg:min-h-[500px] lg:items-center"
		>
			<div class="relative z-10 max-w-[40rem] min-w-0">
				<p
					class="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
				>
					<span class="size-1.5 rounded-full bg-amber-500" aria-hidden="true"></span>
					Shutting down on <time datetime={date}>{day}</time>
				</p>
				<h1
					class="mt-6 font-display text-[2.25rem] leading-[1.05] font-bold tracking-[-0.045em] text-balance sm:text-[3rem] lg:text-[3.5rem]"
				>
					hansi.codes is closing.
				</h1>
				<p class="mt-6 max-w-[36rem] text-lg text-stone-500 sm:text-xl dark:text-stone-400">
					The hosted service stops on {day}. Hansi itself stays: it's open source, and you can run
					the same reviewer on your own server today.
				</p>
				<div class="mt-9 flex flex-wrap items-center gap-4">
					<a href="#self-host" class="px-5 py-3 {button}">Host it yourself</a>
					<a href="#next" class="px-5 py-3 {secondaryButton}">See what's next</a>
				</div>
			</div>
			<!-- Hansi the cat stays on the page to the end. -->
			<AsciiHansi
				class="mt-8 w-full text-[6.5px] sm:mt-10 sm:text-[7px] lg:absolute lg:inset-x-0 lg:top-1/2 lg:mt-0 lg:-translate-y-1/2 lg:text-[9px]"
			/>
		</section>

		<section
			class="grid gap-10 border-t border-stone-200 py-20 md:grid-cols-[1fr_2fr] md:gap-16 dark:border-stone-800"
			aria-labelledby="timeline-title"
		>
			<h2 id="timeline-title" class={sectionTitle}>What happens now</h2>
			<ol class="min-w-0 space-y-0">
				<li class="relative border-l border-stone-300 pb-8 pl-6 dark:border-stone-700">
					<span
						class="absolute top-1.5 -left-[5px] size-2.5 rounded-full bg-emerald-500"
						aria-hidden="true"
					></span>
					<p class="font-semibold">Until {day}</p>
					<p class="mt-1.5 text-stone-500 dark:text-stone-400">
						Reviews keep running as usual and the dashboard stays open. New sign-ups are closed.
					</p>
				</li>
				<li class="relative border-l border-stone-300 pb-8 pl-6 dark:border-stone-700">
					<span
						class="absolute top-1.5 -left-[5px] size-2.5 rounded-full bg-amber-500"
						aria-hidden="true"
					></span>
					<p class="font-semibold">On {day}</p>
					<p class="mt-1.5 text-stone-500 dark:text-stone-400">
						The hosted service shuts down. Hansi stops reviewing pull requests, and the dashboard
						goes offline.
					</p>
				</li>
				<li class="relative pl-6">
					<span
						class="absolute top-1.5 -left-[4.5px] size-2.5 rounded-full bg-stone-400"
						aria-hidden="true"
					></span>
					<p class="font-semibold">Before then, on your side</p>
					<p class="mt-1.5 text-stone-500 dark:text-stone-400">
						Move to a self-hosted instance if you want to keep Hansi, then uninstall the hansi.codes
						GitHub App under your GitHub settings, in Applications.
					</p>
				</li>
			</ol>
		</section>

		<section
			id="self-host"
			class="scroll-mt-8 border-t border-stone-200 py-20 dark:border-stone-800"
			aria-labelledby="self-host-title"
		>
			<div class="grid gap-10 md:grid-cols-[1fr_1.15fr] md:gap-16">
				<div class="min-w-0">
					<h2 id="self-host-title" class={sectionTitle}>Keep Hansi, on your own server</h2>
					<p class="mt-4 max-w-[32rem] text-stone-500 dark:text-stone-400">
						Everything hansi.codes did runs from the open-source repository. You need a server
						GitHub can reach over HTTPS, a domain, and a model key.
					</p>
					<div class="mt-8 flex flex-wrap items-center gap-4">
						<a href={selfHostGuide} class="px-5 py-3 {button}" target="_blank" rel="noreferrer"
							>Read the self-hosting guide</a
						>
						<a
							href={repo}
							class="inline-flex items-center gap-2 {navLink}"
							target="_blank"
							rel="noreferrer">{@render githubIcon()} View on GitHub</a
						>
					</div>
				</div>
				<figure
					class="min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
					aria-label="Three commands to start Hansi"
				>
					<div
						class="border-b border-stone-200 px-4 py-2.5 font-mono text-xs text-stone-500 [font-variant-ligatures:none] dark:border-stone-800 dark:text-stone-400"
					>
						terminal
					</div>
					<div
						class="space-y-4 overflow-x-auto p-4 font-mono text-[0.8rem] leading-[1.85] [font-variant-ligatures:none]"
					>
						{#each steps as step (step.command)}
							<div class="w-max min-w-full">
								<p class="whitespace-pre text-stone-400 dark:text-stone-500">{step.comment}</p>
								<p class="whitespace-pre">
									<span class="text-stone-400 select-none dark:text-stone-600">$&nbsp;</span><code
										>{step.command}</code
									>
								</p>
							</div>
						{/each}
					</div>
				</figure>
			</div>

			<ul class="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
				{#each selfHostFacts as fact (fact.title)}
					<li class="min-w-0">
						<h3 class="font-display text-base font-bold tracking-[-0.03em]">{fact.title}</h3>
						<p class="mt-2 text-[0.95rem] text-stone-500 dark:text-stone-400">{fact.text}</p>
					</li>
				{/each}
			</ul>
		</section>

		<section
			id="next"
			class="scroll-mt-8 border-t border-stone-200 py-20 dark:border-stone-800"
			aria-labelledby="next-title"
		>
			<div
				class="relative overflow-hidden rounded-2xl bg-stone-900 px-6 py-14 text-white sm:px-12 sm:py-16 dark:bg-stone-100 dark:text-stone-900"
			>
				<p
					class="font-mono text-sm text-stone-400 [font-variant-ligatures:none] dark:text-stone-500"
				>
					<span aria-hidden="true">&gt;&nbsp;</span>hansi --next
				</p>
				<h2
					id="next-title"
					class="mt-4 max-w-[20ch] font-display text-2xl font-bold tracking-[-0.04em] text-balance sm:text-[2.5rem] sm:leading-[1.1]"
				>
					Something new is coming.
				</h2>
				<p class="mt-5 max-w-[34rem] text-stone-300 dark:text-stone-600">
					This isn't the last you'll hear from Hansi. There's a new home in the works, and we can't
					say more just yet. Watch the repository on GitHub to hear about it first.
				</p>
				<a
					href={repo}
					class="mt-8 inline-flex items-center gap-2 rounded-[0.6rem] bg-white px-5 py-3 font-semibold text-stone-900 transition-colors hover:bg-stone-200 motion-reduce:transition-none dark:bg-stone-900 dark:text-white dark:hover:bg-stone-700 {focus}"
					target="_blank"
					rel="noreferrer">{@render githubIcon()} Watch on GitHub</a
				>
			</div>
		</section>

		<section class="border-t border-stone-200 pt-16 pb-20 dark:border-stone-800">
			<p class="max-w-[40rem] text-lg text-stone-500 dark:text-stone-400">
				Thank you to everyone who let Hansi read their pull requests during the beta. Every bug it
				caught, and every one it missed, made it a better reviewer.
			</p>
			<p class="mt-4 font-semibold">Torsten, and Hansi the cat</p>
		</section>
	</main>

	<footer
		class="mx-auto flex max-w-[70rem] items-center justify-between border-t border-stone-200 px-4 py-8 sm:px-6 dark:border-stone-800"
	>
		<span class="flex items-center gap-2 font-display text-lg font-bold tracking-[-0.04em]"
			><Logo class="size-5" />Hansi</span
		>
		<nav aria-label="Footer" class="flex items-center gap-6">
			<a href={repo} class="flex items-center gap-2 {navLink}" target="_blank" rel="noreferrer">
				{@render githubIcon()}
				GitHub
			</a>
			<a href={selfHostGuide} class={navLink} target="_blank" rel="noreferrer">Self-hosting</a>
		</nav>
	</footer>
</div>
