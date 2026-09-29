<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Verdict } from '@hans/config';
	import RetryReviewButton from '$lib/components/RetryReviewButton.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import TierBadge from '$lib/components/TierBadge.svelte';
	import { formatCost, formatDate, verdictLabel } from '$lib/format';

	type ReviewRow = {
		id: string;
		repository: string;
		pullNumber: number;
		status: string;
		verdict: Verdict | null;
		tier: string | null;
		costUsd: number;
		createdAt: Date | string | number;
		posted: number;
	};

	let { reviews }: { reviews: ReviewRow[] } = $props();
</script>

<div class="card overflow-x-auto">
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
			{#each reviews as review (review.id)}
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
							<span class="inline-flex items-center gap-2">
								<StatusBadge status={review.status} />
								{#if review.status === 'failed'}
									<RetryReviewButton reviewId={review.id} />
								{/if}
							</span>
						{/if}
					</td>
					<td class="px-4 py-2">{review.posted}</td>
					<td class="px-4 py-2 text-right tabular-nums">{formatCost(review.costUsd)}</td>
					<td class="muted px-4 py-2 whitespace-nowrap tabular-nums">
						{formatDate(review.createdAt)}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
