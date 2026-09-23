<script lang="ts">
	import { resolve } from '$app/paths';
	import '@fontsource-variable/martian-mono';
	import anthropicLogo from '$lib/assets/providers/anthropic.svg';
	import bedrockLogo from '$lib/assets/providers/bedrock.svg';
	import geminiLogo from '$lib/assets/providers/gemini.svg';
	import openaiLogo from '$lib/assets/providers/openai.svg';
	import openrouterLogo from '$lib/assets/providers/openrouter.svg';
	import xaiLogo from '$lib/assets/providers/xai.svg';
	import AsciiHansi from '$lib/components/AsciiHansi.svelte';

	let { data } = $props();

	const start = $derived(data.configured ? resolve('/login') : resolve('/setup'));

	type CodeRow = { ln?: number; sign: ' ' | '+' | '-'; text: string };

	const before: CodeRow[] = [
		{ ln: 31, sign: ' ', text: 'export async function cancelOrder(id: string) {' },
		{ sign: '-', text: '  const order = await db.orders.find(id);' },
		{ ln: 32, sign: '+', text: '  const order = db.orders.find(id);' }
	];
	const after: CodeRow[] = [
		{
			ln: 33,
			sign: ' ',
			text: "  if (order.status === 'shipped') throw new Error('Already shipped');"
		}
	];

	// Logos are static SVG files from $lib/assets/providers (MIT, LobeHub Icons), drawn as masks
	// so they take the text color in light and dark mode.
	const providerLogos = [
		{ name: 'OpenAI', logo: openaiLogo },
		{ name: 'Anthropic', logo: anthropicLogo },
		{ name: 'Amazon Bedrock', logo: bedrockLogo },
		{ name: 'Google Gemini', logo: geminiLogo },
		{ name: 'xAI', logo: xaiLogo },
		{ name: 'OpenRouter', logo: openrouterLogo }
	];

	const plan = [
		'Unlimited repositories',
		'Reviews on every push',
		'Approvals, grades, and inline fixes',
		'Answers when you mention @hansi',
		'Your own model and API key'
	];

	const faqs = [
		{
			q: 'Which models can Hansi use?',
			a: 'Any model from OpenAI, Anthropic, xAI, Google, or OpenRouter, plus any OpenAI-compatible endpoint. You can use a stronger model to review and a cheaper one to double-check findings.'
		},
		{
			q: 'What does it cost?',
			a: 'Hansi is free during the beta. You pay your model provider directly for the tokens each review uses, and every review shows its token usage and cost.'
		},
		{
			q: 'What happens to my code?',
			a: 'Hansi reads the pull request to review it and sends the relevant code to the model provider you chose. The checkout is deleted when the review finishes.'
		},
		{
			q: 'Will it flood my pull requests with comments?',
			a: 'No. Hansi only comments on obvious mistakes, and a second pass drops anything it cannot confirm. Most good pull requests get no comments at all, just an approval.'
		},
		{
			q: 'Can it approve pull requests?',
			a: 'Yes. Hansi approves clean pull requests and requests changes when it finds a real problem. It never approves pull requests from people without write access to the repository.'
		}
	];

	const focus =
		'rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-400';
	const button = `inline-flex items-center justify-center rounded-[0.6rem] bg-stone-900 dark:bg-stone-100 font-semibold text-white dark:text-stone-900 transition-colors hover:bg-stone-700 dark:hover:bg-stone-300 motion-reduce:transition-none ${focus}`;
	const navLink = `font-medium text-stone-500 dark:text-stone-400 transition-colors hover:text-stone-900 dark:hover:text-stone-100 motion-reduce:transition-none ${focus}`;
	const sectionTitle =
		'font-display text-2xl font-bold tracking-[-0.04em] text-balance sm:text-[2rem] sm:leading-[1.15]';
</script>

<svelte:head>
	<title>Hansi: AI code review that catches real bugs</title>
	<meta
		name="description"
		content="AI code review for GitHub that runs on your own model key: OpenAI, Anthropic, Amazon Bedrock, OpenRouter, and more. It catches real bugs, approves the rest, and grades each pull request from S to F."
	/>
</svelte:head>

{#snippet avatar(size: 'sm' | 'md')}
	<span
		class="grid shrink-0 place-items-center rounded-full bg-stone-900 font-bold text-white dark:bg-stone-100 dark:text-stone-900 {size ===
		'sm'
			? 'size-6 text-xs'
			: 'size-8'}"
		aria-hidden="true">h</span
	>
{/snippet}

{#snippet codeRows(rows: CodeRow[])}
	<div
		class="overflow-x-auto py-1 font-mono text-[0.78rem] leading-[1.85] [font-variant-ligatures:none]"
	>
		{#each rows as row, i (i)}
			<div
				class="w-max min-w-full pr-4 whitespace-pre {row.sign === '+'
					? 'bg-emerald-50 dark:bg-emerald-950/50'
					: row.sign === '-'
						? 'bg-red-50 dark:bg-red-950/50'
						: ''}"
			>
				<span class="inline-block w-10 pr-3 text-right text-stone-400 dark:text-stone-600"
					>{row.ln ?? ''}</span
				><span class="inline-block w-5 text-stone-500 dark:text-stone-400">{row.sign}</span
				>{row.text}
			</div>
		{/each}
	</div>
{/snippet}

<div
	class="min-h-screen bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100"
>
	<header class="mx-auto flex h-18 max-w-[70rem] items-center justify-between px-4 sm:px-6">
		<a
			href={resolve('/')}
			class="flex items-baseline gap-2 font-display text-xl font-bold tracking-[-0.04em] {focus}"
		>
			Hansi<span
				class="font-mono text-sm font-medium tracking-normal text-stone-400 [font-variant-ligatures:none]"
				aria-hidden="true">=^.^=</span
			>
		</a>
		<nav aria-label="Main" class="flex items-center gap-7">
			<a href="#pricing" class="hidden sm:inline {navLink}">Pricing</a>
			<a href="#faq" class="hidden sm:inline {navLink}">FAQ</a>
			<a href={start} class="hidden sm:inline {navLink}">Sign in</a>
			<a href={start} class="px-4 py-2 text-sm {button}">Get started</a>
		</nav>
	</header>

	<main class="mx-auto max-w-[70rem] px-4 sm:px-6">
		<section
			class="relative pt-12 pb-10 sm:pt-20 sm:pb-14 lg:flex lg:min-h-[500px] lg:items-center"
		>
			<div class="relative z-10 max-w-[40rem] min-w-0">
				<h1
					class="font-display text-[2.25rem] leading-[1.05] font-bold tracking-[-0.045em] text-balance sm:text-[3rem] lg:text-[3.5rem]"
				>
					Curious about your code.
				</h1>
				<p class="mt-6 max-w-[36rem] text-lg text-stone-500 sm:text-xl dark:text-stone-400">
					AI code review for GitHub that runs on your own model key: OpenAI, Anthropic, Bedrock,
					OpenRouter, and more. It catches real bugs and approves the rest.
				</p>
				<div class="mt-9 flex flex-wrap items-center gap-5">
					<a href={start} class="px-5 py-3 {button}">Install on GitHub</a>
					<span class="text-[0.95rem] text-stone-500 dark:text-stone-400">
						Free during the beta.
					</span>
				</div>
			</div>
			<!-- Named after Hansi, the founder's cat. The canvas spans the hero so the fly can too. -->
			<AsciiHansi
				class="mt-10 hidden text-[7px] sm:block lg:absolute lg:inset-x-0 lg:top-1/2 lg:mt-0 lg:-translate-y-1/2 lg:text-[9px]"
			/>
		</section>

		<!-- The product: a pull request as Hansi leaves it. -->
		<figure
			class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_30px_60px_-30px_rgb(28_25_23/0.18)] dark:border-stone-800 dark:bg-stone-900 dark:shadow-none"
			aria-label="A pull request reviewed by Hansi"
		>
			<div
				class="flex items-start justify-between gap-4 border-b border-stone-200 px-4 py-5 sm:px-6 dark:border-stone-800"
			>
				<div class="min-w-0">
					<p class="text-xl font-semibold tracking-[-0.01em]">
						feat: let customers cancel orders <span
							class="font-normal text-stone-500 dark:text-stone-400">#42</span
						>
					</p>
					<p
						class="mt-1.5 flex flex-wrap items-center gap-2.5 text-sm text-stone-500 dark:text-stone-400"
					>
						<span
							class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
							>Open</span
						>
						anna wants to merge 3 commits into main
					</p>
				</div>
				<span
					class="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-2xl font-bold text-amber-800 ring-1 ring-amber-300 ring-inset sm:size-13 sm:text-3xl dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800"
					title="Tier B: needs changes">B</span
				>
			</div>

			<div class="grid gap-6 bg-stone-50 p-4 sm:p-6 lg:grid-cols-[0.9fr_1.1fr] dark:bg-stone-950">
				<div class="flex min-w-0 gap-3">
					{@render avatar('md')}
					<div class="min-w-0 flex-1">
						<p
							class="flex flex-wrap items-center gap-2 text-[0.925rem] text-stone-500 dark:text-stone-400"
						>
							<strong class="text-stone-900 dark:text-stone-100">Hansi</strong> requested changes
							<span
								class="rounded-full bg-red-100 px-2 py-px text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-300"
								>Changes requested</span
							>
						</p>
						<div
							class="mt-3 rounded-xl border border-stone-200 bg-white p-4 text-[0.925rem] dark:border-stone-800 dark:bg-stone-900"
						>
							<p class="flex items-center gap-2 font-semibold">
								<span
									class="grid size-6 place-items-center rounded-md bg-amber-100 text-sm font-bold text-amber-800 ring-1 ring-amber-300 ring-inset dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800"
									>B</span
								>
								Needs changes before merging
							</p>
							<p class="mt-2 text-stone-500 dark:text-stone-400">
								Adds order cancellation. One bug lets shipped orders be cancelled; everything else
								looks good.
							</p>
							<div
								class="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-200 pt-3.5 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400"
							>
								<span><b class="text-stone-900 dark:text-stone-100">1</b> comment</span>
								<span><b class="text-stone-900 dark:text-stone-100">3</b> files reviewed</span>
								<span
									><b class="text-stone-900 dark:text-stone-100">2</b> findings filtered out</span
								>
							</div>
						</div>
					</div>
				</div>

				<div
					class="min-w-0 overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
				>
					<div
						class="border-b border-stone-200 px-4 py-2.5 font-mono text-xs text-stone-500 [font-variant-ligatures:none] dark:border-stone-800 dark:text-stone-400"
					>
						src/orders.ts
					</div>
					{@render codeRows(before)}
					<div
						class="mx-3 my-1.5 flex gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3.5 text-[0.9rem] dark:border-stone-800 dark:bg-stone-950"
					>
						{@render avatar('sm')}
						<div class="min-w-0">
							<p class="font-semibold">
								Missing <code class="font-mono text-[0.88em]">await</code>
							</p>
							<p class="mt-1 text-stone-500 dark:text-stone-400">
								<code class="font-mono text-[0.88em]">find()</code> returns a promise, so
								<code class="font-mono text-[0.88em]">order.status</code> is always undefined and shipped
								orders can be cancelled.
							</p>
							<div
								class="mt-3 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800"
							>
								{@render codeRows([
									{ sign: '+', text: '  const order = await db.orders.find(id);' }
								])}
							</div>
						</div>
					</div>
					{@render codeRows(after)}
				</div>
			</div>
		</figure>

		<section
			class="grid gap-14 pt-20 pb-16 md:grid-cols-3 md:gap-12 md:pt-28 md:pb-20"
			aria-label="What Hansi does"
		>
			<div class="min-w-0">
				<h2 class="font-display text-lg font-bold tracking-[-0.03em]">
					Speaks up only for real mistakes
				</h2>
				<p class="mt-2.5 text-stone-500 dark:text-stone-400">
					Hansi flags the bugs you would want a teammate to catch: a missing await, an inverted
					check, an off-by-one. A second pass drops anything it can't confirm.
				</p>
				<div
					class="mt-6 space-y-2 rounded-xl border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900"
					aria-label="One review: 3 possible issues found, 2 dropped, 1 posted"
				>
					<p class="flex items-center gap-3">
						<span
							class="grid size-6 place-items-center rounded-md bg-stone-100 font-bold dark:bg-stone-800"
							>3</span
						>
						possible issues found
					</p>
					<p class="flex items-center gap-3 text-stone-500 dark:text-stone-400">
						<span
							class="grid size-6 place-items-center rounded-md bg-stone-100 font-bold dark:bg-stone-800"
							>2</span
						>
						<span class="line-through decoration-stone-400">dropped after double-checking</span>
					</p>
					<p class="flex items-center gap-3">
						<span
							class="grid size-6 place-items-center rounded-md bg-stone-900 font-bold text-white dark:bg-stone-100 dark:text-stone-900"
							>1</span
						>
						comment posted
					</p>
				</div>
			</div>

			<div class="min-w-0">
				<h2 class="font-display text-lg font-bold tracking-[-0.03em]">Approves like a teammate</h2>
				<p class="mt-2.5 text-stone-500 dark:text-stone-400">
					Clean pull requests get approved. When something is wrong, Hansi requests changes, and
					once you push the fix it checks again and approves.
				</p>
				<div
					class="mt-6 space-y-2 rounded-xl border border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-900"
				>
					<p class="flex items-center gap-2.5">
						<span class="size-2 rounded-full bg-red-500"></span>Hansi requested changes
					</p>
					<p class="flex items-center gap-2.5 text-stone-500 dark:text-stone-400">
						<span class="size-2 rounded-full bg-stone-400"></span>anna pushed 1 commit
					</p>
					<p class="flex items-center gap-2.5">
						<span class="size-2 rounded-full bg-emerald-500"></span>Hansi approved these changes
					</p>
				</div>
			</div>

			<div class="min-w-0">
				<h2 class="font-display text-lg font-bold tracking-[-0.03em]">
					A grade for every pull request
				</h2>
				<p class="mt-2.5 text-stone-500 dark:text-stone-400">
					Each review ends with a grade from S, ready to merge, to F, do not merge. Open findings
					cap the grade, so it always matches what Hansi found.
				</p>
				<div
					class="mt-6 flex justify-between rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
				>
					{#each ['S', 'A', 'B', 'C', 'D', 'F'] as letter (letter)}
						<span
							class="grid size-9 place-items-center rounded-lg text-lg font-bold {letter === 'S'
								? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300 ring-inset dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800'
								: 'text-stone-500 dark:text-stone-400'}">{letter}</span
						>
					{/each}
				</div>
			</div>
		</section>

		<section
			id="providers"
			class="border-t border-stone-200 py-20 dark:border-stone-800"
			aria-labelledby="providers-title"
		>
			<h2 id="providers-title" class={sectionTitle}>Bring your own model</h2>
			<ul class="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each providerLogos as provider (provider.name)}
					<li
						class="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-4 dark:border-stone-800 dark:bg-stone-900"
					>
						<span
							class="size-7 shrink-0 bg-current [mask-image:var(--logo)] [mask-size:contain] [mask-position:center] [mask-repeat:no-repeat] [-webkit-mask-image:var(--logo)] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]"
							style="--logo: url({JSON.stringify(provider.logo)})"
							aria-hidden="true"
						></span>
						<span class="min-w-0 font-semibold">{provider.name}</span>
					</li>
				{/each}
			</ul>
		</section>

		<section
			id="pricing"
			class="grid items-center gap-10 border-t border-stone-200 py-20 md:grid-cols-[1fr_24rem] md:gap-16 dark:border-stone-800"
			aria-labelledby="pricing-title"
		>
			<div class="min-w-0">
				<h2 id="pricing-title" class={sectionTitle}>Free during the beta</h2>
				<p class="mt-4 max-w-[32rem] text-stone-500 dark:text-stone-400">
					Unlimited repositories and reviews while Hansi is in beta. You pay your model provider
					directly for the tokens each review uses, and Hansi shows you the cost of every review.
				</p>
			</div>
			<div
				class="rounded-2xl border border-stone-200 bg-white p-7 dark:border-stone-800 dark:bg-stone-900"
			>
				<p class="text-5xl leading-none font-bold tracking-[-0.04em]">
					$0<span
						class="ml-1.5 text-base font-medium tracking-normal text-stone-500 dark:text-stone-400"
						>per month</span
					>
				</p>
				<ul class="my-6 space-y-2.5">
					{#each plan as item (item)}
						<li class="flex items-center gap-2.5">
							<svg
								class="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
								viewBox="0 0 16 16"
								fill="none"
								aria-hidden="true"
							>
								<path
									d="m3 8.5 3 3 7-7"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
							{item}
						</li>
					{/each}
				</ul>
				<a href={start} class="w-full px-5 py-3 {button}">Install on GitHub</a>
			</div>
		</section>

		<section
			id="faq"
			class="grid gap-10 border-t border-stone-200 py-20 md:grid-cols-[1fr_2fr] md:gap-16 dark:border-stone-800"
			aria-labelledby="faq-title"
		>
			<h2 id="faq-title" class={sectionTitle}>Questions</h2>
			<div class="min-w-0">
				{#each faqs as item (item.q)}
					<details class="group border-b border-stone-200 first:border-t dark:border-stone-800">
						<summary
							class="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden {focus}"
						>
							{item.q}
							<span
								class="text-xl leading-none font-normal text-stone-500 dark:text-stone-400"
								aria-hidden="true"
							>
								<span class="group-open:hidden">+</span><span class="hidden group-open:inline"
									>−</span
								>
							</span>
						</summary>
						<p class="max-w-[40rem] pb-5 text-stone-500 dark:text-stone-400">{item.a}</p>
					</details>
				{/each}
			</div>
		</section>

		<section
			class="flex flex-wrap items-center justify-between gap-8 border-t border-stone-200 pt-20 pb-24 dark:border-stone-800"
		>
			<h2 class="max-w-[20ch] {sectionTitle}">Let Hansi review your next pull request.</h2>
			<a href={start} class="px-5 py-3 {button}">Install on GitHub</a>
		</section>
	</main>

	<footer
		class="mx-auto flex max-w-[70rem] items-center justify-between border-t border-stone-200 px-4 py-8 sm:px-6 dark:border-stone-800"
	>
		<span class="flex items-baseline gap-2 font-display text-lg font-bold tracking-[-0.04em]"
			>Hansi<span
				class="font-mono text-sm font-medium tracking-normal text-stone-400 [font-variant-ligatures:none]"
				aria-hidden="true">=^.^=</span
			></span
		>
		<a href={start} class={navLink}>Sign in</a>
	</footer>
</div>
