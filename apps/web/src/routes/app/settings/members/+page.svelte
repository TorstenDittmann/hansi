<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/format';

	let { data, form } = $props();
	let copiedUrl = $state<string | null>(null);

	function roleLabel(role: string) {
		if (role === 'owner') return 'Owner';
		if (role === 'admin') return 'Admin';
		if (role === 'member') return 'Member';
		return role;
	}

	async function copyLink() {
		const url = data.inviteLink?.url;
		if (!url) return;
		await navigator.clipboard.writeText(url);
		copiedUrl = url;
	}
</script>

<div class="space-y-10">
	<header>
		<h1 class="text-2xl font-semibold">Members</h1>
	</header>

	{#if form?.error}
		<div
			class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
		>
			{form.error}
		</div>
	{/if}

	<section>
		<ul class="card divide-y divide-stone-200 dark:divide-stone-800">
			{#each data.members as member (member.id)}
				<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
					<div class="flex min-w-0 items-center gap-3">
						{#if member.image}
							<img src={member.image} alt="" class="size-8 rounded-full" />
						{/if}
						<div class="min-w-0">
							<p class="truncate font-medium">{member.name}</p>
							<p class="muted truncate">
								{#if member.assignableRoles.length > 1}
									{member.email}
								{:else}
									{member.email} · {roleLabel(member.role)}
								{/if}
							</p>
						</div>
					</div>
					<div class="flex shrink-0 flex-wrap items-center gap-2">
						{#if member.assignableRoles.length > 1}
							<form method="post" action="?/updateRole" use:enhance class="flex items-center gap-2">
								<input type="hidden" name="memberId" value={member.id} />
								<select
									name="role"
									class="input w-auto"
									aria-label="Role for {member.name}"
									value={member.role}
								>
									{#each member.assignableRoles as role (role)}
										<option value={role}>{roleLabel(role)}</option>
									{/each}
								</select>
								<button class="btn">Update</button>
							</form>
						{/if}
						{#if member.role !== 'owner'}
							<form method="post" action="?/remove" use:enhance>
								<input type="hidden" name="memberId" value={member.id} />
								<button class="btn btn-danger">Remove</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	{#if data.invitations.length}
		<section>
			<h2 class="text-lg font-semibold">Pending invitations</h2>
			<ul class="card mt-3 divide-y divide-stone-200 dark:divide-stone-800">
				{#each data.invitations as invitation (invitation.id)}
					<li class="flex items-center justify-between gap-3 px-4 py-3">
						<div>
							<p class="font-medium">{invitation.email}</p>
							<p class="muted">
								{roleLabel(invitation.role ?? 'member')} · expires {formatDate(
									invitation.expiresAt
								)}
							</p>
						</div>
						<form method="post" action="?/cancel" use:enhance>
							<input type="hidden" name="invitationId" value={invitation.id} />
							<button class="btn">Cancel</button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.canInvite}
		<section class="card space-y-4 p-4">
			<div>
				<p class="font-medium">Invite link</p>
				<p class="muted">Anyone with this link can join as a member.</p>
			</div>
			{#if data.inviteLink}
				<div class="flex flex-col gap-2 sm:flex-row">
					<input
						class="input min-w-0 flex-1 font-mono text-sm"
						readonly
						value={data.inviteLink.url}
						aria-label="Invite link"
					/>
					<button type="button" class="btn" onclick={copyLink}>
						{copiedUrl === data.inviteLink.url ? 'Copied' : 'Copy'}
					</button>
					<form method="post" action="?/revokeLink" use:enhance>
						<button class="btn">Revoke</button>
					</form>
				</div>
			{:else}
				<form method="post" action="?/createLink" use:enhance>
					<button class="btn btn-primary">Create invite link</button>
				</form>
			{/if}
		</section>
	{/if}

	<form method="post" action="?/invite" use:enhance class="card space-y-4 p-4">
		<p class="font-medium">Invite someone</p>
		<div class="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
			<input
				name="email"
				type="email"
				required
				class="input"
				placeholder="teammate@example.com"
				aria-label="Email"
			/>
			<select name="role" class="input" aria-label="Role">
				<option value="member">Member</option>
				<option value="admin">Admin</option>
			</select>
			<button class="btn btn-primary">Invite</button>
		</div>
	</form>
</div>
