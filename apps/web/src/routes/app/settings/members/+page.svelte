<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '$lib/format';

	let { data, form } = $props();
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
				<li class="flex items-center justify-between gap-3 px-4 py-3">
					<div class="flex items-center gap-3">
						{#if member.image}
							<img src={member.image} alt="" class="size-8 rounded-full" />
						{/if}
						<div>
							<p class="font-medium">{member.name}</p>
							<p class="muted">{member.email} · {member.role}</p>
						</div>
					</div>
					{#if member.role !== 'owner'}
						<form method="post" action="?/remove" use:enhance>
							<input type="hidden" name="memberId" value={member.id} />
							<button class="btn btn-danger">Remove</button>
						</form>
					{/if}
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
							<p class="muted">{invitation.role} · expires {formatDate(invitation.expiresAt)}</p>
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
