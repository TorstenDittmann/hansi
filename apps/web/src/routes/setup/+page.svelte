<script lang="ts">
	import { resolve } from '$app/paths';
	let { data } = $props();

	let appName = $state('');
	let organization = $state('');
	let countApprovals = $state(false);

	const name = $derived(appName.trim() || (data.configured ? '' : data.defaultName));
	const manifest = $derived.by(() => {
		if (data.configured) return '';
		const base = countApprovals ? data.manifests.countingApprovals : data.manifests.advisory;
		return JSON.stringify({ ...base, name });
	});
	const action = $derived.by(() => {
		if (data.configured) return '';
		const base = organization.trim()
			? `https://github.com/organizations/${encodeURIComponent(organization.trim())}/settings/apps/new`
			: 'https://github.com/settings/apps/new';
		return `${base}?state=${encodeURIComponent(data.state)}`;
	});
</script>

<div class="mx-auto max-w-xl">
	<h1 class="text-2xl font-semibold">Set up Hansi</h1>

	{#if data.configured}
		<div class="card mt-6 space-y-4 p-6">
			<p>
				The GitHub App <strong class="font-mono">{data.slug}</strong> is connected. Sign in, then install
				the app on the accounts and repositories you want reviewed.
			</p>
			<div class="flex gap-3">
				<a href={resolve('/login')} class="btn btn-primary">Sign in</a>
				<a href="https://github.com/apps/{data.slug}/installations/new" class="btn">Install app</a>
			</div>
		</div>
	{:else}
		<p class="muted mt-2">
			Hansi talks to GitHub through a GitHub App that you own. This creates one with the right
			permissions and webhooks, and stores its credentials encrypted in your database.
		</p>

		{#if data.isLocal}
			<div
				class="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
			>
				<code>APP_URL</code> is <code>{data.publicUrl}</code>. GitHub can't deliver webhooks to
				localhost, so start a tunnel (e.g. <code>cloudflared tunnel --url {data.publicUrl}</code>)
				and set <code>APP_URL</code> to its address before creating the app.
			</div>
		{/if}

		<form method="post" {action} class="card mt-6 space-y-4 p-6">
			<div>
				<label class="label" for="app-name">App name</label>
				<input
					id="app-name"
					class="input"
					placeholder={data.defaultName}
					maxlength="34"
					bind:value={appName}
				/>
				<p class="muted mt-1">Must be unique on GitHub. Users will mention it as @name.</p>
			</div>
			<div>
				<label class="label" for="organization">GitHub organization (optional)</label>
				<input
					id="organization"
					class="input"
					placeholder="Leave empty to create it on your personal account"
					bind:value={organization}
				/>
			</div>
			<div class="flex gap-3">
				<input
					id="count-approvals"
					type="checkbox"
					class="mt-1 rounded border-stone-300 dark:border-stone-700"
					bind:checked={countApprovals}
				/>
				<label for="count-approvals" class="text-sm">
					<span class="font-medium">Let Hansi's approvals count toward required reviews</span>
					<span class="muted block">
						GitHub only counts approvals from reviewers with write access, so this gives the app
						write access to code. Hansi never pushes code, but anyone with the app's key could. With
						one required approval, Hansi alone could then approve a merge. Without this, use the
						<code>Hansi</code> check run to gate merges.
					</span>
				</label>
			</div>
			<input type="hidden" name="manifest" value={manifest} />
			<button type="submit" class="btn btn-primary">Create GitHub App</button>
		</form>
	{/if}
</div>
