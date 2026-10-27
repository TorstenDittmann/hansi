<script lang="ts">
	import {
		buildTrace,
		formatMs,
		type TraceEvent,
		type TraceItem,
		type TraceTone
	} from '$lib/trace';

	let { events }: { events: TraceEvent[] } = $props();

	const entries = $derived(buildTrace(events));

	const tones: Record<TraceTone, string> = {
		default: 'text-stone-500',
		ok: 'text-emerald-700 dark:text-emerald-400',
		warn: 'text-amber-700 dark:text-amber-400',
		error: 'text-red-700 dark:text-red-400',
		muted: 'text-stone-400 dark:text-stone-500'
	};

	const offset = (seconds: number) =>
		seconds < 60
			? `+${seconds}s`
			: `+${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
</script>

{#snippet details(item: TraceItem)}
	<div class="space-y-2 px-4 pb-3 sm:pl-[13.5rem]">
		{#if item.code}
			<pre
				class="overflow-x-auto rounded bg-stone-100 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-stone-900">{item.code}</pre>
		{/if}
		<pre
			class="overflow-x-auto rounded bg-stone-100 p-3 font-mono text-xs break-all whitespace-pre-wrap text-stone-600 dark:bg-stone-900 dark:text-stone-400">{JSON.stringify(
				item.data,
				null,
				2
			)}</pre>
	</div>
{/snippet}

{#snippet row(item: TraceItem)}
	<details class="group">
		<summary
			class="flex cursor-pointer list-none items-baseline gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-900 [&::-webkit-details-marker]:hidden"
		>
			<span
				class="hidden w-12 shrink-0 text-right font-mono text-xs text-stone-400 tabular-nums sm:block"
			>
				{offset(item.offset)}
			</span>
			<span class="w-24 shrink-0 text-xs font-medium sm:w-32 {tones[item.tone]}">{item.label}</span>
			<span
				class="min-w-0 flex-1 truncate group-open:break-all group-open:whitespace-normal {item.mono
					? 'font-mono text-xs'
					: ''}">{item.summary}</span
			>
			{#if item.meta.length}
				<span class="hidden shrink-0 gap-1 sm:flex">
					{#each item.meta as fact (fact)}
						<span
							class="badge bg-stone-100 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
						>
							{fact}
						</span>
					{/each}
				</span>
			{/if}
		</summary>
		{@render details(item)}
	</details>
{/snippet}

<ol class="card mt-3 divide-y divide-stone-200 text-sm dark:divide-stone-800">
	{#each entries as entry (entry.kind === 'event' ? entry.item.id : entry.start.id)}
		<li>
			{#if entry.kind === 'event'}
				{@render row(entry.item)}
			{:else}
				{@const end = entry.end}
				<details class="group/agent">
					<summary
						class="flex cursor-pointer list-none items-baseline gap-3 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-900 [&::-webkit-details-marker]:hidden"
					>
						<span
							class="hidden w-12 shrink-0 text-right font-mono text-xs text-stone-400 tabular-nums sm:block"
						>
							{offset(entry.start.offset)}
						</span>
						<span class="w-24 shrink-0 text-xs font-medium text-sky-700 sm:w-32 dark:text-sky-400">
							<span class="inline-block transition-transform group-open/agent:rotate-90">▸</span>
							Subagent {entry.agent}
						</span>
						<span class="min-w-0 flex-1">
							<span class="line-clamp-2 group-open/agent:line-clamp-none">{entry.task}</span>
							{#if entry.paths.length}
								<span class="mt-1 block truncate font-mono text-xs text-stone-500">
									{entry.paths.join(', ')}
								</span>
							{/if}
						</span>
						<span class="hidden shrink-0 gap-1 sm:flex">
							<span
								class="badge bg-stone-100 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
							>
								{entry.items.length} steps
							</span>
							{#if end}
								<span class="badge bg-stone-100 text-xs dark:bg-stone-800 {tones[end.tone]}">
									{end.type === 'subagent.failed' ? 'failed' : end.summary}
								</span>
								{#if typeof end.data?.ms === 'number'}
									<span
										class="badge bg-stone-100 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
									>
										{formatMs(end.data.ms)}
									</span>
								{/if}
							{:else}
								<span
									class="badge bg-sky-100 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-300"
								>
									running
								</span>
							{/if}
						</span>
					</summary>
					<ol
						class="ml-2 divide-y divide-stone-200 border-l-2 border-sky-200 sm:ml-[4.75rem] dark:divide-stone-800 dark:border-sky-900"
					>
						{#each entry.items as item (item.id)}
							<li>{@render row(item)}</li>
						{/each}
						{#if end}
							<li>{@render row(end)}</li>
						{/if}
					</ol>
				</details>
			{/if}
		</li>
	{/each}
</ol>
