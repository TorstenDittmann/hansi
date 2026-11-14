import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user
		? {
				id: locals.user.id,
				name: locals.user.name,
				email: locals.user.email,
				image: locals.user.image ?? null,
				login: (locals.user.githubLogin as string | null | undefined) ?? null
			}
		: null
});
