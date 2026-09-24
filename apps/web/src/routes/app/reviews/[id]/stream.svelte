<script lang="ts">
	import { watchReview } from './review.remote';

	let {
		id,
		onReview
	}: {
		id: string;
		onReview: (review: Awaited<ReturnType<typeof watchReview>>) => void;
	} = $props();

	// Awaited in the template so the live query stays connected only while this component is mounted.
	const current = $derived(await watchReview(id));

	$effect.pre(() => {
		onReview(current);
	});
</script>
