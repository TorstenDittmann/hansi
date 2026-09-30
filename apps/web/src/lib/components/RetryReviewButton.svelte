<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { reviewId, primary = false }: { reviewId: string; primary?: boolean } = $props();
	const org = $derived(page.data.organization?.slug ?? '');
	let pending = $state(false);
</script>

<form
	method="POST"
	action="{resolve('/app/[org]/reviews/[id]', { org, id: reviewId })}?/retry"
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
