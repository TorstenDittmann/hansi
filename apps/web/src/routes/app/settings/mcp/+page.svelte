<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/format';

	let { data, form } = $props();
	let copied = $state('');

	async function copy(text: string, id: string) {
		await navigator.clipboard.writeText(text);
		copied = id;
	}

	function keepValues() {
		return async ({
			result,
			update
		}: {
			result: { type: string; data?: Record<string, unknown> };
			update: (opts?: { reset?: boolean }) => Promise<void>;
		}) => {
			await update({ reset: result.type === 'success' && result.data?.saved === true });
		};
	}
</script>

<div class="space-y-10">
	<header>
		<h1 class="text-2xl font-semibold">MCP</h1>
		<p class="muted mt-2 max-w-2xl">
			Connect coding agents to Hansi, and let reviews look up tickets, docs, and designs from MCP
			servers you choose.
		</p>
	</header>

	{#if form?.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	{#if form && 'createdKey' in form && form.createdKey}
		<div class="card space-y-3 p-4">
			<p class="font-medium">Copy this key. It is shown only once.</p>
			<div class="flex flex-wrap gap-2">
				<input class="input font-mono" readonly value={form.createdKey.secret} />
				<button
					type="button"
					class="btn"
					onclick={() => form.createdKey && copy(form.createdKey.secret, 'secret')}
				>
					{copied === 'secret' ? 'Copied' : 'Copy'}
				</button>
			</div>
			<p class="muted">Use it as a bearer token. Revoke it here if it leaks.</p>
		</div>
	{/if}

	<section class="space-y-4">
		<div>
			<h2 class="text-lg font-semibold">Connect an agent</h2>
			<p class="muted mt-1 max-w-2xl">
				Cursor, Claude Code, VS Code, and Codex can read reviews, open findings, and request a new
				review. A key belongs to this organization. <code>write</code> can trigger reviews and edit
				learnings; it includes <code>read</code>.
			</p>
		</div>

		<div class="card space-y-3 p-4">
			<p class="text-sm font-medium">Cursor</p>
			<pre class="overflow-x-auto rounded-md bg-stone-100 p-3 text-xs dark:bg-stone-950"><code
					>{data.cursorConfig}</code
				></pre>
			<button type="button" class="btn" onclick={() => copy(data.cursorConfig, 'config')}>
				{copied === 'config' ? 'Copied' : 'Copy config'}
			</button>
			<p class="muted">
				Replace <code>hsk_…</code> with a key. The server is
				<code>{data.endpoint}</code>. Claude Code:
				<code
					>claude mcp add --transport http hansi {data.endpoint} --header "Authorization: Bearer hsk_…"</code
				>
			</p>
		</div>

		<form method="post" action="?/createKey" use:enhance class="card space-y-3 p-4">
			<label class="label" for="key-name">New key</label>
			<div class="flex flex-wrap items-center gap-3">
				<input
					id="key-name"
					name="name"
					class="input max-w-xs"
					required
					maxlength="60"
					placeholder="Cursor on my laptop"
				/>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="scopes" value="read" checked /> read
				</label>
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" name="scopes" value="write" checked /> write
				</label>
				<button class="btn btn-primary">Create key</button>
			</div>
		</form>

		{#if data.keys.length === 0}
			<p class="muted">No keys yet.</p>
		{:else}
			<ul class="card divide-y divide-stone-200 dark:divide-stone-800">
				{#each data.keys as key (key.id)}
					<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
						<div>
							<p class="font-medium">{key.name}</p>
							<p class="muted mt-1">
								<code>{key.keyPrefix}…{key.keyHint}</code>
								· {key.scopes.join(', ')}
								· {key.lastUsedAt ? `used ${formatDate(key.lastUsedAt)}` : 'never used'}
							</p>
						</div>
						<form method="post" action="?/revokeKey" use:enhance>
							<input type="hidden" name="keyId" value={key.id} />
							<button class="btn btn-danger">Revoke</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="space-y-4">
		<div>
			<h2 class="text-lg font-semibold">Context for reviews</h2>
			<p class="muted mt-1 max-w-2xl">
				Hansi calls the tools you allow while reviewing and while answering a comment. What comes
				back is treated as untrusted, the same way pull request text is. Nothing is sent until the
				model asks.
				{#if data.allowPrivate}
					This instance can reach MCP servers on a private network.
				{:else}
					The URL has to be https and publicly reachable.
				{/if}
			</p>
		</div>

		{@render serverForm(null)}

		{#each data.servers as server (server.id)}
			{@render serverForm(server)}
		{/each}
	</section>
</div>

{#snippet serverForm(server: (typeof data.servers)[number] | null)}
	{@const formKey = server?.id ?? 'new'}
	{@const discovered = form && 'discovered' in form ? form.discovered : null}
	<form method="post" use:enhance={keepValues} class="card space-y-3 p-4">
		<input type="hidden" name="formKey" value={formKey} />
		<div class="grid gap-3 sm:grid-cols-2">
			<div>
				<label class="label" for="{formKey}-name">Name</label>
				<input
					id="{formKey}-name"
					name="name"
					class="input font-mono"
					required
					maxlength="32"
					pattern={'[a-z][a-z0-9-]{0,31}'}
					title="Lowercase letters, numbers, and hyphens"
					placeholder="linear"
					value={server?.name ?? ''}
				/>
			</div>
			<div>
				<label class="label" for="{formKey}-url">URL</label>
				<input
					id="{formKey}-url"
					name="url"
					type="url"
					class="input"
					required
					placeholder="https://mcp.example.com/mcp"
					value={server?.url ?? ''}
				/>
			</div>
		</div>
		<div>
			<label class="label" for="{formKey}-token">Bearer token</label>
			<input
				id="{formKey}-token"
				name="token"
				type="password"
				autocomplete="off"
				class="input"
				placeholder={server?.hasToken ? 'Leave blank to keep the current token' : 'Optional'}
			/>
			{#if server?.hasToken}
				<label class="mt-2 flex items-center gap-2 text-sm">
					<input type="checkbox" name="clearToken" /> Remove the stored token
				</label>
			{/if}
		</div>
		<div>
			<label class="label" for="{formKey}-guidance">Usage guidance</label>
			<textarea
				id="{formKey}-guidance"
				name="guidance"
				rows="2"
				maxlength="2000"
				class="input"
				placeholder="Look up the Linear ticket named in the pull request title before judging whether the change does what was asked."
				>{server?.guidance ?? ''}</textarea
			>
		</div>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="enabled" checked={server ? server.enabled : true} />
			Use this server during reviews
		</label>

		{#if discovered && discovered.formKey === formKey}
			<fieldset class="space-y-2">
				<legend class="label">Tools Hansi may call</legend>
				{#if discovered.tools.length === 0}
					<p class="muted">That server did not list any tools.</p>
				{/if}
				{#each discovered.tools as mcpTool (mcpTool.name)}
					<label class="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							name="tools"
							value={mcpTool.name}
							checked={!server || server.allowedTools.includes(mcpTool.name)}
						/>
						<span>
							<span class="font-mono">{mcpTool.name}</span>
							{#if mcpTool.description}
								<span class="muted block">{mcpTool.description}</span>
							{/if}
						</span>
					</label>
				{/each}
				<input type="hidden" name="toolsTouched" value="1" />
			</fieldset>
		{:else if server}
			<p class="muted">
				{server.allowedTools.length === 0
					? 'No tools allowed yet. Check the connection and choose some.'
					: `Allowed: ${server.allowedTools.join(', ')}`}
			</p>
		{/if}

		<div class="flex flex-wrap gap-2">
			<button class="btn" formaction="?/discover">Check connection</button>
			<button class="btn btn-primary" formaction="?/save">{server ? 'Save' : 'Add server'}</button>
			{#if server}
				<button class="btn btn-danger" formaction="?/delete" formnovalidate>Delete</button>
			{/if}
		</div>
	</form>
{/snippet}
