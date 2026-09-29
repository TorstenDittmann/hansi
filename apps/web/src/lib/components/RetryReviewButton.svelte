<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { reviewId, primary = false }: { reviewId: string; primary?: boolean } = $props();
	let pending = $state(false);
</script>

<form
	method="POST"
	action="{resolve('/app/reviews/[id]', { id: reviewId })}?/retry"
	use:enhance={() => {
		pending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				pending = false;
			}
		};
	}}
>
	<button class="btn {primary ? 'btn-primary' : ''} shrink-0" type="submit" disabled={pending}>
		{pending ? 'Retrying…' : 'Retry'}
	</button>
</form>
