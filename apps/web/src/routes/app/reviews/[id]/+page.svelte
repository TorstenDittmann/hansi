<script lang="ts">
	import { resolve } from '$app/paths';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TierBadge from '$lib/components/TierBadge.svelte';
	import {
		formatCost,
		formatDate,
		formatDuration,
		formatTokens,
		tierMeaning,
		verdictLabel
	} from '$lib/format';

	let { data } = $props();
	const review = $derived(data.review);
	// Posted findings stay listed after a conversation resolves or dismisses them.
	const posted = $derived(review.findings.filter((f) => f.status !== 'dropped'));
	const dropped = $derived(review.findings.filter((f) => f.status === 'dropped'));
</script>

<div class="space-y-8">
	<header>
		<a href={resolve('/app')} class="muted hover:underline">← Overview</a>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="font-mono text-2xl font-semibold">{review.repository}#{review.pullNumber}</h1>
			<StatusBadge status={review.status} />
			<a
				class="muted hover:underline"
				href="https://github.com/{review.repository}/pull/{review.pullNumber}"
			>
				Open on GitHub ↗
			</a>
		</div>
		<dl class="muted mt-3 flex flex-wrap gap-x-6 gap-y-1">
			<div>Trigger: {review.trigger}</div>
			<div>Created: {formatDate(review.createdAt)}</div>
			<div>Duration: {formatDuration(review.startedAt, review.finishedAt)}</div>
			<div>
				Tokens: {formatTokens(review.inputTokens)} in / {formatTokens(review.outputTokens)} out
			</div>
			<div>Cost: {formatCost(review.costUsd)}</div>
		</dl>
	</header>

	{#if review.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
		>
			{review.error}
		</div>
	{/if}

	{#if review.tier}
		<section class="card flex items-center gap-4 p-4">
			<TierBadge tier={review.tier} size="lg" />
			<div>
				<p class="font-medium">
					{tierMeaning[review.tier]}
					{#if review.verdict}
						<span class="muted">· {verdictLabel[review.verdict]} on GitHub</span>
					{/if}
				</p>
				{#if review.tierReason}
					<p class="muted mt-1">{review.tierReason}</p>
				{/if}
			</div>
		</section>
	{/if}

	{#if review.summary}
		<section>
			<h2 class="text-lg font-semibold">Summary</h2>
			<p class="mt-2">{review.summary}</p>
		</section>
	{/if}

	{#snippet findingList(findings: typeof review.findings)}
		<ul class="mt-3 space-y-3">
			{#each findings as finding (finding.id)}
				<li class="card p-4">
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<span class="font-mono">{finding.path}:{finding.startLine}-{finding.endLine}</span>
						<span class="badge bg-stone-100 dark:bg-stone-800">{finding.severity}</span>
						<span class="badge bg-stone-100 dark:bg-stone-800">{finding.category}</span>
						{#if finding.status === 'resolved' || finding.status === 'dismissed'}
							<StatusBadge status={finding.status} />
						{/if}
					</div>
					<p class="mt-2 font-medium">{finding.title}</p>
					<p class="mt-1 text-sm whitespace-pre-wrap text-stone-700 dark:text-stone-300">
						{finding.body}
					</p>
					{#if finding.dropReason}
						<p class="muted mt-2">
							{finding.status === 'dropped' ? 'Dropped' : 'Reason'}: {finding.dropReason}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/snippet}

	<section>
		<h2 class="text-lg font-semibold">Posted comments ({posted.length})</h2>
		{#if posted.length}
			{@render findingList(posted)}
		{:else}
			<p class="muted mt-2">No comments posted.</p>
		{/if}
	</section>

	{#if dropped.length}
		<section>
			<h2 class="text-lg font-semibold">Filtered out ({dropped.length})</h2>
			<p class="muted">Findings Hansi did not post, and why.</p>
			{@render findingList(dropped)}
		</section>
	{/if}

	<section>
		<h2 class="text-lg font-semibold">Model calls</h2>
		{#if review.calls.length}
			<div class="card mt-3 overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-stone-200 text-stone-500 dark:border-stone-800">
						<tr>
							<th class="px-4 py-2 font-medium">Role</th>
							<th class="px-4 py-2 font-medium">Model</th>
							<th class="px-4 py-2 font-medium">Input</th>
							<th class="px-4 py-2 font-medium">Cached</th>
							<th class="px-4 py-2 font-medium">Output</th>
							<th class="px-4 py-2 font-medium">Time</th>
							<th class="px-4 py-2 font-medium">Cost</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-200 dark:divide-stone-800">
						{#each review.calls as call (call.id)}
							<tr>
								<td class="px-4 py-2">{call.role}</td>
								<td class="px-4 py-2 font-mono">{call.provider}/{call.model}</td>
								<td class="px-4 py-2">{formatTokens(call.inputTokens)}</td>
								<td class="px-4 py-2">{formatTokens(call.cachedInputTokens)}</td>
								<td class="px-4 py-2">{formatTokens(call.outputTokens)}</td>
								<td class="px-4 py-2">{(call.durationMs / 1000).toFixed(1)}s</td>
								<td class="px-4 py-2">{formatCost(call.costUsd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="muted mt-2">No model calls recorded.</p>
		{/if}
	</section>

	<section>
		<h2 class="text-lg font-semibold">Trace</h2>
		<p class="muted">What the agent looked at, in order.</p>
		{#if review.events.length}
			<ol class="card mt-3 divide-y divide-stone-200 font-mono text-xs dark:divide-stone-800">
				{#each review.events as event (event.id)}
					<li class="flex gap-4 px-4 py-2">
						<span class="w-40 shrink-0 text-stone-500">{event.type}</span>
						<span class="break-all">{event.data ? JSON.stringify(event.data) : ''}</span>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="muted mt-2">No events recorded.</p>
		{/if}
	</section>
</div>
