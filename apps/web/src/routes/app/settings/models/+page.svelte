<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/format';

	let { data, form } = $props();

	let provider = $state('openai');
	const providerInfo = $derived(data.providers.find((p) => p.id === provider));

	const roles = [
		{
			id: 'review' as const,
			name: 'Review',
			description: 'Explores the code and writes findings. Use your strongest model.'
		},
		{
			id: 'verify' as const,
			name: 'Verify',
			description:
				'Double-checks findings before they are posted. Optional; defaults to the review model.'
		}
	];

	const assignmentFor = (role: string) => data.assignments.find((a) => a.role === role);
	const modelsFor = (credentialId: string | undefined) =>
		(form && 'models' in form && form.credentialId === credentialId && form.models) || [];
</script>

<div class="space-y-10">
	<header>
		<h1 class="text-2xl font-semibold">Models</h1>
		<p class="muted">
			Hansi uses your own API keys. Keys are encrypted at rest and never shown again after saving.
		</p>
	</header>

	{#if form && 'error' in form && form.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
		>
			{form.error}
		</div>
	{/if}

	<section>
		<h2 class="text-lg font-semibold">Assignments</h2>
		{#if data.credentials.length === 0}
			<p class="muted mt-2">Add a provider key below first.</p>
		{:else}
			<div class="mt-3 space-y-3">
				{#each roles as role (role.id)}
					{@const current = assignmentFor(role.id)}
					<form method="post" action="?/assign" use:enhance class="card space-y-3 p-4">
						<input type="hidden" name="role" value={role.id} />
						<div>
							<p class="font-medium">{role.name}</p>
							<p class="muted">{role.description}</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
							<select name="credentialId" class="input" value={current?.credentialId ?? ''}>
								<option value="">{role.id === 'review' ? 'Choose a key' : 'Same as review'}</option>
								{#each data.credentials as credential (credential.id)}
									<option value={credential.id}>{credential.label}</option>
								{/each}
							</select>
							<input
								name="modelId"
								class="input font-mono"
								placeholder="Model id, e.g. claude-sonnet-5"
								list="models-{role.id}"
								value={current?.modelId ?? ''}
							/>
							<datalist id="models-{role.id}">
								{#each modelsFor(current?.credentialId) as model (model.id)}
									<option value={model.id}>{model.name ?? model.id}</option>
								{/each}
							</datalist>
							<button class="btn btn-primary">Save</button>
						</div>
					</form>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="text-lg font-semibold">Provider keys</h2>
		{#if data.credentials.length}
			<ul class="card mt-3 divide-y divide-stone-200 dark:divide-stone-800">
				{#each data.credentials as credential (credential.id)}
					<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
						<div>
							<p class="font-medium">{credential.label}</p>
							<p class="muted font-mono">
								{credential.provider}{credential.keyHint
									? ` · …${credential.keyHint}`
									: ''}{credential.region ? ` · ${credential.region}` : ''}{credential.baseUrl
									? ` · ${credential.baseUrl}`
									: ''}
							</p>
							<p class="muted">Verified {formatDate(credential.lastVerifiedAt)}</p>
						</div>
						<div class="flex gap-2">
							<form method="post" action="?/models" use:enhance>
								<input type="hidden" name="credentialId" value={credential.id} />
								<button class="btn">Load models</button>
							</form>
							<form method="post" action="?/delete" use:enhance>
								<input type="hidden" name="credentialId" value={credential.id} />
								<button class="btn btn-danger">Remove</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
			{#if form && 'models' in form && form.models}
				<p class="muted mt-2">
					Loaded {form.models.length} models. Pick one in an assignment that uses this key.
				</p>
			{/if}
		{/if}

		<form method="post" action="?/add" use:enhance class="card mt-4 space-y-4 p-4">
			<p class="font-medium">Add a key</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label class="label" for="provider">Provider</label>
					<select id="provider" name="provider" class="input" bind:value={provider}>
						{#each data.providers as option (option.id)}
							<option value={option.id}>{option.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="label" for="label">Label</label>
					<input id="label" name="label" class="input" placeholder={providerInfo?.name} />
				</div>
				<div class="sm:col-span-2">
					<label class="label" for="apiKey">
						{provider === 'amazon-bedrock' ? 'Bedrock API key or IAM access key' : 'API key'}
					</label>
					<input
						id="apiKey"
						name="apiKey"
						type="password"
						autocomplete="off"
						class="input font-mono"
						required={provider !== 'openai-compatible'}
					/>
					{#if provider === 'amazon-bedrock'}
						<p class="muted mt-1">
							Paste a Bedrock API key, or IAM credentials as
							<code>ACCESS_KEY_ID:SECRET_ACCESS_KEY</code>. The key needs access to the models you
							want to use.
						</p>
					{:else if providerInfo?.keyUrl}
						<p class="muted mt-1">
							Get a key at <a class="underline" href={providerInfo.keyUrl}>{providerInfo.keyUrl}</a>
						</p>
					{/if}
				</div>
				{#if providerInfo?.requiresRegion}
					<div class="sm:col-span-2">
						<label class="label" for="region">Region</label>
						<input
							id="region"
							name="region"
							class="input font-mono"
							placeholder="us-east-1"
							required
						/>
					</div>
				{/if}
				<div class="sm:col-span-2">
					<label class="label" for="baseUrl">
						Base URL {providerInfo?.requiresBaseUrl ? '' : '(optional)'}
					</label>
					<input
						id="baseUrl"
						name="baseUrl"
						class="input font-mono"
						placeholder={providerInfo?.defaultBaseUrl}
						required={providerInfo?.requiresBaseUrl}
					/>
					{#if provider === 'openai-compatible'}
						<p class="muted mt-1">Ollama, vLLM, LiteLLM, Groq, Together, DeepSeek, and others.</p>
					{/if}
				</div>
			</div>
			<button class="btn btn-primary">Test and save</button>
		</form>
	</section>
</div>
