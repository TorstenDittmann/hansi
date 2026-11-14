<script lang="ts">
	import LandingPage from '$lib/components/LandingPage.svelte';
	import SunsetPage from '$lib/components/SunsetPage.svelte';

	let { data } = $props();
</script>

{#if data.sunset}
	<SunsetPage date={data.sunset.date} organization={data.sunset.organization} />
{:else}
	<LandingPage configured={data.configured} />
{/if}
