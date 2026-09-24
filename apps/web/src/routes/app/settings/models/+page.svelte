<script lang="ts">
	import { enhance } from '$app/forms';
	import ProviderLogo from '$lib/components/ProviderLogo.svelte';

	let { data, form } = $props();

	type Model = { id: string; name?: string };
	type ModelList =
		| { status: 'loading' }
		| { status: 'ready'; models: Model[] }
		| { status: 'error'; message: string };

	const roles = [
		{
			id: 'review' as const,
			name: 'Review',
			description: 'Explores the code and writes findings. Use your strongest model.'
		},
		{
			id: 'verify' as const,
			name: 'Verify',
			description: 'Double-checks findings before they are posted. Uses the review model if unset.'
		}
	];
	const bedrockRegions = [
		'us-east-1',
		'us-west-2',
		'eu-central-1',
		'eu-west-1',
		'ap-northeast-1',
		'ap-southeast-2'
	];

	/** The provider being connected, if the form is open. */
	let adding: string | null = $state(null);
	let region = $state('');
	/** The role whose model picker is open, and the key it lists models for. */
	let picking: { role: string; credentialId: string } | null = $state(null);
	let query = $state('');
	let modelLists: Record<string, ModelList> = $state({});

	const addingInfo = $derived(data.providers.find((p) => p.id === adding));
	const assignmentFor = (role: string) => data.assignments.find((a) => a.role === role);
	const credentialFor = (id: string | undefined) => data.credentials.find((c) => c.id === id);

	async function loadModels(credentialId: string) {
		if (modelLists[credentialId]?.status === 'ready') return;
		modelLists[credentialId] = { status: 'loading' };
		const response = await fetch(`/app/settings/models/list?credential=${credentialId}`);
		modelLists[credentialId] = response.ok
			? { status: 'ready', models: await response.json() }
			: {
					status: 'error',
					message: (await response.json().catch(() => null))?.message ?? 'Could not load models'
				};
	}

	function openPicker(role: string, credentialId = data.credentials[0]?.id) {
		if (!credentialId) return;
		picking = { role, credentialId };
		query = '';
		void loadModels(credentialId);
	}

	const matches = (model: Model) =>
		`${model.id} ${model.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
</script>

<div class="space-y-12">
	<header>
		<h1 class="text-2xl font-semibold">Models</h1>
	</header>

	{#if form && 'error' in form && form.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Models in use</h2>
		{#if data.credentials.length === 0}
			<p class="muted">Connect a provider below, then choose the models Hansi reviews with.</p>
		{:else}
			{#each roles as role (role.id)}
				{@const current = assignmentFor(role.id)}
				{@const currentKey = credentialFor(current?.credentialId)}
				{@const open = picking?.role === role.id}
				<div class="card p-4">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="font-medium">{role.name}</p>
							<p class="muted">{role.description}</p>
						</div>
						{#if !open}
							<button
								type="button"
								class="btn {current || role.id === 'verify' ? '' : 'btn-primary'}"
								onclick={() => openPicker(role.id, current?.credentialId)}
							>
								{current ? 'Change' : 'Choose a model'}
							</button>
						{/if}
					</div>

					{#if current && currentKey && !open}
						<div
							class="mt-3 flex items-center gap-3 rounded-md bg-stone-100 px-3 py-2 dark:bg-stone-800"
						>
							<ProviderLogo provider={currentKey.provider} class="size-5" />
							<span class="min-w-0 truncate font-mono text-sm">{current.modelId}</span>
							<span class="muted ml-auto shrink-0">{currentKey.label}</span>
						</div>
					{:else if !current && !open && role.id === 'verify'}
						<p class="muted mt-3">Using the review model.</p>
					{/if}

					{#if open && picking}
						{@const list = modelLists[picking.credentialId]}
						<div class="mt-4 space-y-4">
							{#if data.credentials.length > 1}
								<div class="flex flex-wrap gap-2" role="group" aria-label="Key">
									{#each data.credentials as credential (credential.id)}
										<button
											type="button"
											class="btn {picking.credentialId === credential.id
												? 'border-stone-900 dark:border-stone-100'
												: ''}"
											aria-pressed={picking.credentialId === credential.id}
											onclick={() => openPicker(role.id, credential.id)}
										>
											<ProviderLogo provider={credential.provider} class="size-4" />
											{credential.label}
										</button>
									{/each}
								</div>
							{/if}

							{#if list?.status === 'loading' || !list}
								<p class="muted">Loading models…</p>
							{:else if list.status === 'error'}
								<p class="text-sm text-red-700 dark:text-red-400">{list.message}</p>
							{:else}
								<input
									class="input"
									type="search"
									placeholder="Search {list.models.length} models"
									aria-label="Search models"
									bind:value={query}
								/>
								<form
									method="post"
									action="?/assign"
									use:enhance={() =>
										async ({ result, update }) => {
											await update();
											if (result.type === 'success') picking = null;
										}}
								>
									<input type="hidden" name="role" value={role.id} />
									<input type="hidden" name="credentialId" value={picking.credentialId} />
									<ul
										class="max-h-80 divide-y divide-stone-200 overflow-y-auto rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800"
									>
										{#each list.models.filter(matches) as model (model.id)}
											{@const selected =
												current?.credentialId === picking.credentialId &&
												current.modelId === model.id}
											<li>
												<button
													name="modelId"
													value={model.id}
													class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800 {selected
														? 'bg-stone-100 dark:bg-stone-800'
														: ''}"
												>
													<span class="min-w-0 flex-1">
														<span class="block truncate font-mono text-sm">{model.id}</span>
														{#if model.name && model.name !== model.id}
															<span class="muted block truncate">{model.name}</span>
														{/if}
													</span>
													{#if selected}<span class="muted shrink-0">Current</span>{/if}
												</button>
											</li>
										{:else}
											<li class="muted px-3 py-2">No models match “{query}”.</li>
										{/each}
									</ul>
								</form>
							{/if}

							<div class="flex flex-wrap items-center gap-2">
								<form method="post" action="?/assign" use:enhance class="flex flex-1 gap-2">
									<input type="hidden" name="role" value={role.id} />
									<input type="hidden" name="credentialId" value={picking.credentialId} />
									<input
										name="modelId"
										class="input font-mono"
										placeholder="Or enter a model id"
										aria-label="Model id"
										required
									/>
									<button class="btn">Use</button>
								</form>
								{#if role.id === 'verify' && current}
									<form method="post" action="?/assign" use:enhance>
										<input type="hidden" name="role" value="verify" />
										<button class="btn">Use the review model</button>
									</form>
								{/if}
								<button type="button" class="btn" onclick={() => (picking = null)}>Cancel</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Providers</h2>

		{#if data.credentials.length}
			<ul class="card divide-y divide-stone-200 dark:divide-stone-800">
				{#each data.credentials as credential (credential.id)}
					<li class="flex items-center gap-3 px-4 py-3">
						<ProviderLogo provider={credential.provider} />
						<div class="min-w-0 flex-1">
							<p class="font-medium">{credential.label}</p>
							<p class="muted truncate font-mono">
								{[
									credential.keyHint && `…${credential.keyHint}`,
									credential.region,
									credential.baseUrl
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						</div>
						<form method="post" action="?/delete" use:enhance>
							<input type="hidden" name="credentialId" value={credential.id} />
							<button class="btn btn-danger">Remove</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<p class="pt-2 font-medium">
			{data.credentials.length ? 'Connect another provider' : 'Connect a provider'}
		</p>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Provider">
			{#each data.providers as provider (provider.id)}
				<button
					type="button"
					class="flex items-center gap-3 rounded-lg border bg-white px-3 py-3 text-left text-sm font-medium hover:border-stone-400 dark:bg-stone-900 dark:hover:border-stone-600 {adding ===
					provider.id
						? 'border-stone-900 ring-1 ring-stone-900 dark:border-stone-100 dark:ring-stone-100'
						: 'border-stone-200 dark:border-stone-800'}"
					aria-pressed={adding === provider.id}
					onclick={() => {
						adding = adding === provider.id ? null : provider.id;
						region = '';
					}}
				>
					<ProviderLogo provider={provider.id} />
					{provider.name}
				</button>
			{/each}
		</div>

		{#if addingInfo}
			<form
				method="post"
				action="?/add"
				class="card space-y-4 p-4"
				use:enhance={() =>
					async ({ result, update }) => {
						await update();
						if (result.type === 'success' && typeof result.data?.added === 'string') {
							adding = null;
							if (!assignmentFor('review')) openPicker('review', result.data.added);
						}
					}}
			>
				<input type="hidden" name="provider" value={addingInfo.id} />
				<div class="flex items-center gap-3">
					<ProviderLogo provider={addingInfo.id} class="size-7" />
					<p class="font-medium">Connect {addingInfo.name}</p>
					{#if addingInfo.keyUrl}
						<a
							class="muted ml-auto underline"
							href={addingInfo.keyUrl}
							target="_blank"
							rel="noreferrer">Get a key</a
						>
					{/if}
				</div>

				{#if addingInfo.requiresBaseUrl}
					<div>
						<label class="label" for="baseUrl">Base URL</label>
						<input
							id="baseUrl"
							name="baseUrl"
							class="input font-mono"
							placeholder={addingInfo.defaultBaseUrl}
							required
						/>
						<p class="muted mt-1">Ollama, vLLM, LiteLLM, Groq, Together, DeepSeek, and others.</p>
					</div>
				{/if}

				<div>
					<label class="label" for="apiKey">
						{addingInfo.id === 'amazon-bedrock'
							? 'Bedrock API key or IAM access key'
							: addingInfo.requiresBaseUrl
								? 'API key (optional)'
								: 'API key'}
					</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="apiKey"
						name="apiKey"
						type="password"
						autocomplete="off"
						class="input font-mono"
						required={!addingInfo.requiresBaseUrl}
						autofocus
					/>
					{#if addingInfo.id === 'amazon-bedrock'}
						<p class="muted mt-1">
							A Bedrock API key, or IAM credentials as <code>ACCESS_KEY_ID:SECRET_ACCESS_KEY</code>.
						</p>
					{/if}
				</div>

				{#if addingInfo.requiresRegion}
					<div>
						<p class="label">Region</p>
						<div class="flex flex-wrap gap-2">
							{#each bedrockRegions as option (option)}
								<button
									type="button"
									class="btn font-mono {region === option
										? 'border-stone-900 dark:border-stone-100'
										: ''}"
									aria-pressed={region === option}
									onclick={() => (region = option)}>{option}</button
								>
							{/each}
						</div>
						<input
							name="region"
							class="input mt-2 font-mono"
							placeholder="Or type another region"
							aria-label="Region"
							bind:value={region}
							required
						/>
					</div>
				{/if}

				<details>
					<summary class="muted cursor-pointer">More options</summary>
					<div class="mt-3 grid gap-4 sm:grid-cols-2">
						<div>
							<label class="label" for="label">Name</label>
							<input id="label" name="label" class="input" placeholder={addingInfo.name} />
						</div>
						{#if !addingInfo.requiresBaseUrl}
							<div>
								<label class="label" for="baseUrl">Base URL</label>
								<input
									id="baseUrl"
									name="baseUrl"
									class="input font-mono"
									placeholder={addingInfo.defaultBaseUrl}
								/>
							</div>
						{/if}
					</div>
				</details>

				<button class="btn btn-primary">Test and connect</button>
			</form>
		{/if}
	</section>
</div>
