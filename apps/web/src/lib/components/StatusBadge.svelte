<script lang="ts">
	let { status }: { status: string } = $props();

	const styles: Record<string, string> = {
		completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
		running: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
		queued: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
		failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
		skipped: 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400',
		superseded: 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400',
		posted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
		dropped: 'bg-stone-100 text-stone-500 dark:bg-stone-900 dark:text-stone-400'
	};
</script>

<span class="badge {styles[status] ?? styles.queued}">{status}</span>
