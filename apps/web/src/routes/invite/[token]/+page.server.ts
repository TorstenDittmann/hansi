import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { getContext } from '$lib/server/context';
import { organizationHome } from '$lib/org-path';
import { INVITE_COOKIE, acceptInviteLink, findActiveInviteLink } from '$lib/server/invite-link';
import { organizationsFor } from '$lib/server/organization';
import type { PageServerLoad } from './$types';

const cookie = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: !dev };

export const load: PageServerLoad = async ({ params, locals, cookies, request }) => {
	const { db } = await getContext();
	const link = await findActiveInviteLink(db, params.token);
	if (!link) {
		cookies.delete(INVITE_COOKIE, cookie);
		return { valid: false as const, title: 'Invite link' };
	}

	if (!locals.user) {
		cookies.set(INVITE_COOKIE, params.token, { ...cookie, maxAge: 60 * 60 });
		redirect(303, `/login?redirectTo=${encodeURIComponent(`/invite/${params.token}`)}`);
	}

	const accepted = await acceptInviteLink(db, locals.user.id, params.token);
	if (!accepted) {
		cookies.delete(INVITE_COOKIE, cookie);
		return { valid: false as const, title: 'Invite link' };
	}

	const auth = await getAuth();
	await auth.api.setActiveOrganization({
		headers: request.headers,
		body: { organizationId: accepted.organizationId }
	});
	if (locals.session) locals.session.activeOrganizationId = accepted.organizationId;
	cookies.delete(INVITE_COOKIE, cookie);
	const { active } = await organizationsFor(locals, request.headers);
	redirect(303, organizationHome(active.slug));
};
