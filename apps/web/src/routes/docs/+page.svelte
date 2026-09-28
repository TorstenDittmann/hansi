<script lang="ts">
	import SiteFrame from '$lib/components/SiteFrame.svelte';

	const focus =
		'rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-400';
	const sectionTitle =
		'font-display text-2xl font-bold tracking-[-0.04em] text-balance sm:text-[2rem] sm:leading-[1.15]';
	const prose = 'mt-4 max-w-[40rem] text-stone-500 dark:text-stone-400';
	const textLink = `font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-900 dark:text-stone-100 dark:decoration-stone-600 dark:hover:decoration-stone-100 ${focus}`;
	const tocLink = `font-medium text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 ${focus}`;

	const toc = [
		{ id: 'how-it-works', label: 'How a review works' },
		{ id: 'configuration', label: 'Repository configuration' },
		{ id: 'verdicts', label: 'Verdicts and grades' },
		{ id: 'hansi-loop', label: 'hansi-loop' }
	];

	const steps = [
		'Install the GitHub App on your repositories and add a model key.',
		'When a pull request is opened or updated, Hansi checks out the code and reads it the way a reviewer would: files, usages, the history of the lines it touches, the issues the pull request closes, and checks that already failed.',
		'A second, skeptical pass double-checks every finding. Only the ones that hold up are posted, as inline comments, with a suggested fix when there is one.',
		'Hansi submits a real review, Approve or Request changes, and grades the pull request from S to F in one summary comment that it keeps up to date.',
		'After a fix is pushed, it reviews only what changed, resolves the threads of findings that are fixed, and approves once nothing blocking is left.'
	];

	const configExample = `{
  "$schema": "https://hansi.codes/schema/v1.json",
  "reviews": {
    "enabled": true,
    "auto": true,
    "drafts": false,
    "baseBranches": [],
    "pathFilters": ["!docs/**", "!**/*.snap"],
    "profile": "balanced",
    "minSeverity": "minor",
    "maxComments": 15,
    "approve": true,
    "requestChanges": "major",
    "approveOutsideContributors": false
  },
  "instructions": "We use Result types instead of exceptions in src/domain.",
  "pathInstructions": [
    { "path": "migrations/**", "instructions": "Check that every migration is reversible." }
  ],
  "language": "en"
}`;

	const fields = [
		['reviews.enabled', 'true', 'Review pull requests in this repository.'],
		[
			'reviews.auto',
			'true',
			'Review when a pull request is opened or updated. Mentions always work.'
		],
		['reviews.drafts', 'false', 'Also review draft pull requests.'],
		[
			'reviews.baseBranches',
			'[]',
			'Only review pull requests into these branches. Empty means all.'
		],
		[
			'reviews.pathFilters',
			'[]',
			'Globs for the files to review. Prefix a pattern with ! to exclude.'
		],
		[
			'reviews.profile',
			'balanced',
			'chill flags confirmed bugs only. balanced and strict dig deeper.'
		],
		[
			'reviews.minSeverity',
			'minor',
			'Findings below this severity (info, minor, major, critical) are not posted.'
		],
		['reviews.maxComments', '15', 'The most inline comments in one review.'],
		['reviews.approve', 'true', 'Approve pull requests without blocking findings.'],
		[
			'reviews.requestChanges',
			'major',
			'Severity from which Hansi requests changes. never only comments.'
		],
		[
			'reviews.approveOutsideContributors',
			'false',
			'Approve pull requests from people without write access.'
		],
		['instructions', '""', 'Extra review instructions for the repository.'],
		['pathInstructions', '[]', 'Instructions for files matching a glob.'],
		['language', 'en', 'Language for review comments.']
	] as const;

	const tiers = [
		['S', 'Ready to merge'],
		['A', 'Mergeable after minor fixes'],
		['B', 'Needs changes'],
		['C', 'Significant problems'],
		['D', 'Serious problems'],
		['F', 'Do not merge']
	] as const;
</script>

<SiteFrame>
	<header class="max-w-[40rem] pt-12 sm:pt-16">
		<h1
			class="font-display text-[2.25rem] leading-[1.05] font-bold tracking-[-0.045em] text-balance sm:text-5xl"
		>
			Documentation
		</h1>
		<p class="mt-4 text-lg text-stone-500 dark:text-stone-400">
			How Hansi reviews a pull request, how to configure it, and what the grades mean.
		</p>
	</header>

	<div class="grid gap-12 py-14 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16 lg:py-16">
		<nav aria-label="On this page" class="lg:sticky lg:top-8 lg:self-start">
			<ol class="flex gap-x-5 gap-y-2 overflow-x-auto text-sm lg:flex-col lg:overflow-visible">
				{#each toc as item (item.id)}
					<li class="shrink-0">
						<a href="#{item.id}" class={tocLink}>{item.label}</a>
					</li>
				{/each}
			</ol>
		</nav>

		<div class="min-w-0">
			<section id="how-it-works" class="scroll-mt-8" aria-labelledby="how-it-works-title">
				<h2 id="how-it-works-title" class={sectionTitle}>How a review works</h2>
				<ol class="mt-8 max-w-[40rem] space-y-5">
					{#each steps as step, index (step)}
						<li class="flex gap-4">
							<span
								class="grid size-7 shrink-0 place-items-center rounded-md bg-stone-900 text-sm font-bold text-white dark:bg-stone-100 dark:text-stone-900"
								>{index + 1}</span
							>
							<p class="pt-0.5 text-stone-500 dark:text-stone-400">{step}</p>
						</li>
					{/each}
				</ol>
				<p class={prose}>
					Reply to any of its comments, or mention the app with a question, and Hansi answers in the
					thread. Tell it "we don't flag this in tests" and it remembers for later reviews.
				</p>
			</section>

			<section
				id="configuration"
				class="mt-16 scroll-mt-8 border-t border-stone-200 pt-16 dark:border-stone-800"
				aria-labelledby="configuration-title"
			>
				<h2 id="configuration-title" class={sectionTitle}>Repository configuration</h2>
				<p class={prose}>
					Add <code class="font-mono text-[0.9em]">.hansi.json</code> to the repository root. The
					<code class="font-mono text-[0.9em]">$schema</code> line gives you autocompletion and
					validation in editors. Hansi also reads
					<code class="font-mono text-[0.9em]">AGENTS.md</code>,
					<code class="font-mono text-[0.9em]">CLAUDE.md</code>,
					<code class="font-mono text-[0.9em]">.cursorrules</code>,
					<code class="font-mono text-[0.9em]">.github/copilot-instructions.md</code>, and
					<code class="font-mono text-[0.9em]">CONTRIBUTING.md</code>
					as review guidelines. Config and guidelines both come from the pull request's base branch, so
					a change takes effect once it is merged. Every field is optional.
				</p>
				<pre
					class="mt-8 overflow-x-auto rounded-xl border border-stone-200 bg-white p-4 font-mono text-[0.8rem] leading-relaxed text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"><code
						>{configExample}</code
					></pre>
				<div
					class="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
				>
					<table class="w-full min-w-[40rem] text-left text-sm">
						<thead>
							<tr
								class="border-b border-stone-200 text-stone-500 dark:border-stone-800 dark:text-stone-400"
							>
								<th class="px-4 py-3 font-medium" scope="col">Field</th>
								<th class="px-4 py-3 font-medium" scope="col">Default</th>
								<th class="px-4 py-3 font-medium" scope="col">What it does</th>
							</tr>
						</thead>
						<tbody>
							{#each fields as [name, fallback, detail] (name)}
								<tr class="border-b border-stone-200 last:border-0 dark:border-stone-800">
									<th
										class="px-4 py-3 font-mono text-[0.8rem] font-medium whitespace-nowrap"
										scope="row">{name}</th
									>
									<td
										class="px-4 py-3 font-mono text-[0.8rem] whitespace-nowrap text-stone-500 dark:text-stone-400"
										>{fallback}</td
									>
									<td class="px-4 py-3 text-stone-500 dark:text-stone-400">{detail}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>

			<section
				id="verdicts"
				class="mt-16 scroll-mt-8 border-t border-stone-200 pt-16 dark:border-stone-800"
				aria-labelledby="verdicts-title"
			>
				<h2 id="verdicts-title" class={sectionTitle}>Verdicts and grades</h2>
				<p class={prose}>
					Each review is submitted to GitHub as <strong
						class="font-semibold text-stone-900 dark:text-stone-100">Approve</strong
					>,
					<strong class="font-semibold text-stone-900 dark:text-stone-100">Request changes</strong>,
					or
					<strong class="font-semibold text-stone-900 dark:text-stone-100">Comment</strong>.
				</p>
				<ul class="{prose} list-disc space-y-2 pl-5">
					<li>
						New findings at or above <code class="font-mono text-[0.9em]">requestChanges</code>:
						<strong class="font-semibold text-stone-900 dark:text-stone-100">Request changes</strong
						>.
					</li>
					<li>
						Blocking findings from an earlier review still open:
						<strong class="font-semibold text-stone-900 dark:text-stone-100">Comment</strong>, so
						the earlier request stays in effect until they are fixed or dismissed in the thread.
					</li>
					<li>
						Otherwise: <strong class="font-semibold text-stone-900 dark:text-stone-100"
							>Approve</strong
						>. Minor findings are still posted as comments, unless
						<code class="font-mono text-[0.9em]">approve</code> is false.
					</li>
				</ul>
				<p class={prose}>The tier grades how ready the pull request is to merge.</p>
				<div
					class="mt-6 max-w-[28rem] overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
				>
					<table class="w-full text-left text-sm">
						<tbody>
							{#each tiers as [letter, meaning] (letter)}
								<tr class="border-b border-stone-200 last:border-0 dark:border-stone-800">
									<th class="w-14 px-4 py-3 text-lg font-bold" scope="row">{letter}</th>
									<td class="px-4 py-3 text-stone-500 dark:text-stone-400">{meaning}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class={prose}>
					The model grades the pull request, but open findings cap the tier: a minor finding means
					at most <strong class="font-semibold text-stone-900 dark:text-stone-100">A</strong>, a
					major one at most
					<strong class="font-semibold text-stone-900 dark:text-stone-100">B</strong>, and a
					critical one at most
					<strong class="font-semibold text-stone-900 dark:text-stone-100">D</strong>. Informational
					notes don't lower it, and with no open findings the tier is
					<strong class="font-semibold text-stone-900 dark:text-stone-100">S</strong>. The Hansi
					check run follows the verdict, so you can require it before merging.
				</p>
			</section>

			<section
				id="hansi-loop"
				class="mt-16 scroll-mt-8 border-t border-stone-200 pt-16 dark:border-stone-800"
				aria-labelledby="hansi-loop-title"
			>
				<h2 id="hansi-loop-title" class={sectionTitle}>hansi-loop</h2>
				<p class={prose}>
					<a
						href="https://github.com/TorstenDittmann/hansi/blob/main/skills/hansi-loop/SKILL.md"
						class={textLink}
						target="_blank"
						rel="noreferrer">hansi-loop</a
					>
					is an agent skill that keeps fixing the current pull request until Hansi grades it
					<strong class="font-semibold text-stone-900 dark:text-stone-100">S</strong> and has no
					comments left open. Install it with the
					<a
						href="https://github.com/vercel-labs/skills"
						class={textLink}
						target="_blank"
						rel="noreferrer">skills CLI</a
					>:
				</p>
				<pre
					class="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white px-4 py-3 font-mono text-sm dark:border-stone-800 dark:bg-stone-900"><code
						>npx skills add TorstenDittmann/hansi --skill hansi-loop</code
					></pre>
				<p class={prose}>
					Then run <code class="font-mono text-[0.9em]">/hansi-loop</code> in your agent. It needs
					the
					<a href="https://cli.github.com" class={textLink} target="_blank" rel="noreferrer"
						>GitHub CLI</a
					>
					(<code class="font-mono text-[0.9em]">gh auth login</code>) and the Hansi GitHub App
					installed on the repository. Pass a pull request number to review that one; otherwise it
					uses the pull request for the current branch.
				</p>
				<p class={prose}>
					Each review spends the repository owner's model credits. The loop stops after 5
					iterations.
				</p>
			</section>

			<p
				class="mt-16 border-t border-stone-200 pt-10 text-stone-500 dark:border-stone-800 dark:text-stone-400"
			>
				To run Hansi on your own server, follow the
				<a
					href="https://github.com/TorstenDittmann/hansi/blob/main/SELFHOST.md"
					class={textLink}
					target="_blank"
					rel="noreferrer">self-hosting guide</a
				>.
			</p>
		</div>
	</div>
</SiteFrame>
