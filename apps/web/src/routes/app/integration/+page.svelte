<script lang="ts">
	import claude from '$lib/assets/providers/claude.svg';
	import codex from '$lib/assets/providers/codex.svg';
	import cursor from '$lib/assets/providers/cursor.svg';
</script>

{#snippet mark(src: string)}
	<span
		class="size-6 shrink-0 bg-current [mask-image:var(--logo)] [mask-size:contain] [mask-position:center] [mask-repeat:no-repeat] [-webkit-mask-image:var(--logo)] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]"
		style="--logo: url({JSON.stringify(src)})"
		aria-hidden="true"
	></span>
{/snippet}

<div class="space-y-8">
	<header>
		<h1 class="text-2xl font-semibold">Integration</h1>
		<p class="muted mt-2 max-w-2xl">
			Install the hansi.codes plugin in your coding agent. It adds <code>/hansi-status</code>,
			<code>/hansi-learn</code>, <code>/hansi-setup</code>, and <code>/hansi-loop</code>, and it
			tells the agent not to resolve Hansi review threads.
		</p>
	</header>

	<section class="card space-y-3 p-5">
		<h2 class="flex items-center gap-2.5 text-lg font-semibold">
			{@render mark(cursor)}
			Cursor
		</h2>
		<p>
			Install <strong>hansi.codes</strong> from the
			<a class="underline" href="https://cursor.com/marketplace">Cursor Marketplace</a>. Then run
			<code>/hansi-status</code>, <code>/hansi-learn</code>, <code>/hansi-setup</code>, or
			<code>/hansi-loop</code>.
		</p>
	</section>

	<section class="card space-y-3 p-5">
		<h2 class="flex items-center gap-2.5 text-lg font-semibold">
			{@render mark(claude)}
			Claude Code
		</h2>
		<p>
			Add this repository as a marketplace, then install the plugin. The same short commands work.
			Claude also registers <code>/hansi.codes:hansi-status</code> and the same prefix on the other skills.
			That prefix is automatic.
		</p>
		<pre
			class="overflow-x-auto rounded-md bg-stone-100 p-3 font-mono text-sm dark:bg-stone-950">{`claude plugin marketplace add TorstenDittmann/hansi
claude plugin install hansi.codes@hansi.codes`}</pre>
	</section>

	<section class="card space-y-3 p-5">
		<h2 class="flex items-center gap-2.5 text-lg font-semibold">
			{@render mark(codex)}
			Codex
		</h2>
		<p>
			Add this repository as a marketplace, then install <strong>hansi-codes</strong>. Run
			<code>$hansi-status</code>, <code>$hansi-learn</code>, <code>$hansi-setup</code>, or
			<code>$hansi-loop</code>.
		</p>
		<pre
			class="overflow-x-auto rounded-md bg-stone-100 p-3 font-mono text-sm dark:bg-stone-950">{`codex plugin marketplace add TorstenDittmann/hansi
codex plugin install hansi-codes --source hansi-codes`}</pre>
	</section>

	<p class="muted max-w-2xl">
		The <a class="underline" href="https://hansi.codes">Hansi GitHub App</a> must be installed on
		the repository. The skills use git and the
		<a class="underline" href="https://cli.github.com">GitHub CLI</a>. Another client is fine when
		that is what the environment has. To install one skill without a marketplace:
	</p>
	<pre
		class="overflow-x-auto rounded-md bg-stone-100 p-3 font-mono text-sm dark:bg-stone-950">npx skills add TorstenDittmann/hansi --skill hansi-loop</pre>
</div>
