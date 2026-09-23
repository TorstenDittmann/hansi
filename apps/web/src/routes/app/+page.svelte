<script lang="ts">
	import { resolve } from '$app/paths';
	import ProviderLogo from '$lib/components/ProviderLogo.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TierBadge from '$lib/components/TierBadge.svelte';
	import { formatCost, formatDate, verdictLabel } from '$lib/format';

	let { data } = $props();
	const costs = $derived(data.costs);

	const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
	const dayLabel = (day: string) =>
		new Date(`${day}T00:00:00Z`).toLocaleDateString('en', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});

	const maxDay = $derived(Math.max(...costs.days.map((d) => d.cost)));
	const total30 = $derived(costs.days.reduce((sum, d) => sum + d.cost, 0));
	const perReview = $derived(costs.month.reviews ? costs.month.cost / costs.month.reviews : null);
	let hovered: number | null = $state(null);
</script>

<div class="space-y-10">
	<header>
		<h1 class="text-2xl font-semibold">Overview</h1>
		<p class="muted">What Hansi has spent on your model keys, and its latest reviews.</p>
	</header>

	<section class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="This month">
		<div class="card p-4">
			<p class="muted">Spend this month</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">{formatCost(costs.month.cost)}</p>
			<p class="muted mt-1">{formatCost(costs.lastMonthCost)} last month</p>
		</div>
		<div class="card p-4">
			<p class="muted">Reviews this month</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">{costs.month.reviews}</p>
		</div>
		<div class="card p-4">
			<p class="muted">Average per review</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">
				{perReview === null ? '–' : formatCost(perReview)}
			</p>
		</div>
		<div class="card p-4">
			<p class="muted">Tokens this month</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">
				{compact.format(costs.month.inputTokens + costs.month.outputTokens)}
			</p>
			<p class="muted mt-1">
				{compact.format(costs.month.inputTokens)} in · {compact.format(costs.month.outputTokens)} out
			</p>
		</div>
	</section>

	<section class="card p-4">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="font-semibold">Daily spend</h2>
			<p class="muted">Last 30 days · {formatCost(total30)}</p>
		</div>

		{#if maxDay === 0}
			<p class="muted py-12 text-center">No spend in the last 30 days.</p>
		{:else}
			<div class="relative mt-6">
				<div
					class="pointer-events-none absolute inset-x-0 top-0 flex justify-end border-t border-dashed border-stone-200 dark:border-stone-800"
					aria-hidden="true"
				>
					<span class="muted -translate-y-full pb-0.5 text-xs tabular-nums"
						>{formatCost(maxDay)}</span
					>
				</div>
				<div
					class="flex h-36 items-end gap-[2px] border-b border-stone-300 dark:border-stone-700"
					role="list"
					aria-label="Spend per day"
				>
					{#each costs.days as day, index (day.day)}
						<div
							class="relative flex h-full flex-1 items-end"
							role="listitem"
							aria-label="{dayLabel(day.day)}: {formatCost(day.cost)}"
							onpointerenter={() => (hovered = index)}
							onpointerleave={() => (hovered = null)}
						>
							<div
								class="w-full rounded-t-[4px] {hovered === index
									? 'bg-stone-500 dark:bg-stone-400'
									: 'bg-stone-800 dark:bg-stone-200'}"
								style="height: {day.cost === 0 ? 0 : Math.max((day.cost / maxDay) * 100, 2)}%"
							></div>
							{#if hovered === index}
								<div
									class="pointer-events-none absolute bottom-full z-10 mb-2 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow-md dark:border-stone-700 dark:bg-stone-900 {index <
									15
										? 'left-0'
										: 'right-0'}"
								>
									<span class="muted">{dayLabel(day.day)}</span>
									<span class="ml-2 font-medium tabular-nums">{formatCost(day.cost)}</span>
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<div class="muted mt-2 flex justify-between text-xs" aria-hidden="true">
					<span>{dayLabel(costs.days[0]!.day)}</span>
					<span>{dayLabel(costs.days[14]!.day)}</span>
					<span>{dayLabel(costs.days[29]!.day)}</span>
				</div>
			</div>
		{/if}
		{#if costs.month.unpriced}
			<p class="muted mt-3">
				{costs.month.unpriced} model call{costs.month.unpriced === 1 ? '' : 's'} this month used a model
				without published pricing and are not included.
			</p>
		{/if}
	</section>

	<div class="grid gap-6 lg:grid-cols-2">
		<section class="card overflow-hidden">
			<h2 class="border-b border-stone-200 px-4 py-3 font-semibold dark:border-stone-800">
				By model <span class="muted font-normal">· 30 days</span>
			</h2>
			{#if costs.byModel.length === 0}
				<p class="muted px-4 py-6">No model calls yet.</p>
			{:else}
				<table class="w-full text-sm">
					<thead class="text-left text-stone-500 dark:text-stone-400">
						<tr>
							<th class="px-4 py-2 font-medium">Model</th>
							<th class="px-4 py-2 text-right font-medium">Tokens</th>
							<th class="px-4 py-2 text-right font-medium">Cost</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-200 dark:divide-stone-800">
						{#each costs.byModel as row (`${row.provider}/${row.model}`)}
							<tr>
								<td class="px-4 py-2">
									<span class="flex min-w-0 items-center gap-2">
										<ProviderLogo provider={row.provider} class="size-4" />
										<span class="truncate font-mono">{row.model}</span>
									</span>
								</td>
								<td class="px-4 py-2 text-right tabular-nums">{compact.format(row.tokens)}</td>
								<td class="px-4 py-2 text-right tabular-nums">{formatCost(row.cost)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section class="card overflow-hidden">
			<h2 class="border-b border-stone-200 px-4 py-3 font-semibold dark:border-stone-800">
				By repository <span class="muted font-normal">· 30 days</span>
			</h2>
			{#if costs.byRepository.length === 0}
				<p class="muted px-4 py-6">No reviews yet.</p>
			{:else}
				<table class="w-full text-sm">
					<thead class="text-left text-stone-500 dark:text-stone-400">
						<tr>
							<th class="px-4 py-2 font-medium">Repository</th>
							<th class="px-4 py-2 text-right font-medium">Reviews</th>
							<th class="px-4 py-2 text-right font-medium">Cost</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-200 dark:divide-stone-800">
						{#each costs.byRepository as row (row.repository)}
							<tr>
								<td class="max-w-0 truncate px-4 py-2 font-mono">{row.repository}</td>
								<td class="px-4 py-2 text-right tabular-nums">{row.reviews}</td>
								<td class="px-4 py-2 text-right tabular-nums">{formatCost(row.cost)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	</div>

	<section>
		<h2 class="text-lg font-semibold">Recent reviews</h2>
		{#if data.reviews.length === 0}
			<p class="muted mt-2">
				Reviews appear here when a pull request is opened or someone comments
				<code>@{data.appSlug ?? 'hansi'} review</code>.
			</p>
		{:else}
			<div class="card mt-3 overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-stone-200 text-stone-500 dark:border-stone-800">
						<tr>
							<th class="px-4 py-2 font-medium">Pull request</th>
							<th class="px-4 py-2 font-medium">Tier</th>
							<th class="px-4 py-2 font-medium">Status</th>
							<th class="px-4 py-2 font-medium">Comments</th>
							<th class="px-4 py-2 text-right font-medium">Cost</th>
							<th class="px-4 py-2 font-medium">Created</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-200 dark:divide-stone-800">
						{#each data.reviews as review (review.id)}
							<tr class="hover:bg-stone-50 dark:hover:bg-stone-800/50">
								<td class="px-4 py-2">
									<a
										class="font-mono hover:underline"
										href={resolve('/app/reviews/[id]', { id: review.id })}
									>
										{review.repository}#{review.pullNumber}
									</a>
								</td>
								<td class="px-4 py-2"><TierBadge tier={review.tier} /></td>
								<td class="px-4 py-2">
									{#if review.status === 'completed' && review.verdict}
										{verdictLabel[review.verdict]}
									{:else}
										<StatusBadge status={review.status} />
									{/if}
								</td>
								<td class="px-4 py-2">{review.posted}</td>
								<td class="px-4 py-2 text-right tabular-nums">{formatCost(review.costUsd)}</td>
								<td class="muted px-4 py-2">{formatDate(review.createdAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
