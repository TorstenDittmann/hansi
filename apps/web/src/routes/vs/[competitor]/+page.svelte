<script lang="ts">
	import { resolve } from '$app/paths';
	import MarketingShell from '$lib/components/MarketingShell.svelte';
	import { button, focus, sectionTitle } from '$lib/marketing';

	let { data } = $props();

	const start = $derived(data.configured ? resolve('/login') : resolve('/setup'));
	const c = $derived(data.comparison);
	const muted = 'text-stone-500 dark:text-stone-400';
	const card =
		'rounded-2xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900';
</script>

<svelte:head>
	<title>{c.headline}: AI code review compared</title>
	<meta name="description" content={c.intro} />
</svelte:head>

<MarketingShell configured={data.configured}>
	<section class="max-w-[44rem] pt-12 pb-12 sm:pt-20">
		<p class="text-sm font-medium {muted}">Comparison</p>
		<h1
			class="mt-3 font-display text-[2.25rem] leading-[1.05] font-bold tracking-[-0.045em] text-balance sm:text-[3rem]"
		>
			{c.headline}
		</h1>
		<p class="mt-6 text-lg {muted}">{c.intro}</p>
	</section>

	<section aria-labelledby="table-title" class="pb-16">
		<h2 id="table-title" class="sr-only">At a glance</h2>
		<div class="overflow-hidden {card} p-0!">
			<div
				class="hidden border-b border-stone-200 px-6 py-3 text-sm font-semibold md:grid md:grid-cols-[11rem_1fr_1fr] md:gap-8 dark:border-stone-800"
				aria-hidden="true"
			>
				<span></span><span>Hansi</span><span>{c.name}</span>
			</div>
			<dl>
				{#each c.rows as row (row.label)}
					<div
						class="grid gap-3 border-b border-stone-200 px-6 py-4 last:border-b-0 md:grid-cols-[11rem_1fr_1fr] md:gap-8 dark:border-stone-800"
					>
						<dt class="font-semibold">{row.label}</dt>
						<dd class="min-w-0">
							<span class="block text-xs font-semibold tracking-wide uppercase md:hidden {muted}"
								>Hansi</span
							>{row.hansi}
						</dd>
						<dd class="min-w-0 {muted}">
							<span class="block text-xs font-semibold tracking-wide uppercase md:hidden"
								>{c.name}</span
							>{row.them}
						</dd>
					</div>
				{/each}
			</dl>
		</div>
		<p class="mt-3 text-sm {muted}">
			Details about {c.name} come from its own website and were last checked in {c.checked}. They
			may have changed since; see the sources at the end of this page.
		</p>
	</section>

	<section
		class="grid gap-10 border-t border-stone-200 py-20 md:grid-cols-2 md:gap-16 dark:border-stone-800"
		aria-label="Differences"
	>
		<div class="min-w-0">
			<h2 class={sectionTitle}>Where Hansi is different</h2>
			<div class="mt-8 space-y-7">
				{#each c.differences as item (item.title)}
					<div>
						<h3 class="font-display text-lg font-bold tracking-[-0.03em]">{item.title}</h3>
						<p class="mt-2 {muted}">{item.body}</p>
					</div>
				{/each}
			</div>
		</div>
		<div class="min-w-0">
			<h2 class={sectionTitle}>When {c.name} is the better choice</h2>
			<ul class="mt-8 space-y-3">
				{#each c.theirStrengths as item (item)}
					<li class="flex gap-3 {card} p-4!">
						<span class="mt-2 size-1.5 shrink-0 rounded-full bg-stone-400" aria-hidden="true"
						></span>
						<span>{item}</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<section
		class="grid gap-10 border-t border-stone-200 py-20 md:grid-cols-[1fr_2fr] md:gap-16 dark:border-stone-800"
		aria-labelledby="switching-title"
	>
		<h2 id="switching-title" class={sectionTitle}>Trying Hansi alongside {c.name}</h2>
		<p class="max-w-[40rem] {muted}">{c.switching}</p>
	</section>

	<section
		class="grid gap-10 border-t border-stone-200 py-20 md:grid-cols-[1fr_2fr] md:gap-16 dark:border-stone-800"
		aria-labelledby="faq-title"
	>
		<h2 id="faq-title" class={sectionTitle}>Questions</h2>
		<div class="min-w-0">
			{#each c.faqs as item (item.q)}
				<details class="group border-b border-stone-200 first:border-t dark:border-stone-800">
					<summary
						class="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden {focus}"
					>
						{item.q}
						<span class="text-xl leading-none font-normal {muted}" aria-hidden="true">
							<span class="group-open:hidden">+</span><span class="hidden group-open:inline">−</span
							>
						</span>
					</summary>
					<p class="max-w-[40rem] pb-5 {muted}">{item.a}</p>
				</details>
			{/each}
		</div>
	</section>

	<section
		class="flex flex-wrap items-center justify-between gap-8 border-t border-stone-200 py-20 dark:border-stone-800"
	>
		<div class="max-w-[32rem]">
			<h2 class={sectionTitle}>See how it does on your code.</h2>
			<p class="mt-3 {muted}">
				Install Hansi on one repository and judge the reviews for yourself. It is free during the
				beta.
			</p>
		</div>
		<a href={start} class="px-5 py-3 {button}">Install on GitHub</a>
	</section>

	<section class="border-t border-stone-200 pt-8 pb-16 text-sm dark:border-stone-800">
		<h2 class="font-semibold">Sources</h2>
		<ul class="mt-3 space-y-1.5 {muted}">
			{#each c.sources as source (source.url)}
				<li>
					<a
						href={source.url}
						class="underline decoration-stone-300 underline-offset-4 hover:text-stone-900 dark:decoration-stone-700 dark:hover:text-stone-100 {focus}"
						target="_blank"
						rel="noreferrer">{source.label}</a
					>
				</li>
			{/each}
		</ul>
		<p class="mt-4 {muted}">
			{c.name} is a trademark of its owner. This page is not affiliated with or endorsed by {c.name}.
			If something here is out of date, let us know and we will fix it.
		</p>
	</section>
</MarketingShell>
