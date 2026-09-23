<script lang="ts">
	import anthropic from '$lib/assets/providers/anthropic.svg';
	import bedrock from '$lib/assets/providers/bedrock.svg';
	import gemini from '$lib/assets/providers/gemini.svg';
	import openai from '$lib/assets/providers/openai.svg';
	import openrouter from '$lib/assets/providers/openrouter.svg';
	import xai from '$lib/assets/providers/xai.svg';

	let { provider, class: className = 'size-6' }: { provider: string; class?: string } = $props();

	const logos: Record<string, string> = {
		openai,
		anthropic,
		'amazon-bedrock': bedrock,
		google: gemini,
		xai,
		openrouter
	};
	const logo = $derived(logos[provider]);
</script>

<!-- Logos are drawn as masks so they take the current text color in both themes. -->
{#if logo}
	<span
		class="shrink-0 bg-current [mask-image:var(--logo)] [mask-size:contain] [mask-position:center] [mask-repeat:no-repeat] [-webkit-mask-image:var(--logo)] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain] {className}"
		style="--logo: url({JSON.stringify(logo)})"
		aria-hidden="true"
	></span>
{:else}
	<svg
		viewBox="0 0 24 24"
		class="shrink-0 {className}"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M8 4 3 12l5 8M16 4l5 8-5 8" />
	</svg>
{/if}
