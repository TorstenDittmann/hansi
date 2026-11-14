import { getContext } from '$lib/server/context';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => ({
	user: locals.user
		? {
				id: locals.user.id,
				name: locals.user.name,
				email: locals.user.email,
				image: locals.user.image ?? null,
				login: (locals.user.githubLogin as string | null | undefined) ?? null
			}
		: null,
	/** Set on the hosted service while it winds down; the dashboard shows a notice. */
	sunsetDate: (await getContext()).env.SUNSET_DATE ?? null
});
