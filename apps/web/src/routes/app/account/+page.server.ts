import { fail, redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { track } from '$lib/server/analytics';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	title: 'Account · Hansi'
});

async function run(action: () => Promise<unknown>) {
	try {
		await action();
	} catch (error) {
		const message = (error as Error).message;
		if (/session.*(expired|fresh)/i.test(message) || message === 'SESSION_EXPIRED') {
			return fail(400, {
				error: 'Sign out and sign back in, then try deleting your account again.'
			});
		}
		return fail(400, { error: message });
	}
}

export const actions: Actions = {
	rename: async ({ locals, request }) => {
		if (!locals.user) redirect(303, '/login');
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'The name cannot be empty' });
		if (name.length > 60) return fail(400, { error: 'Keep the name under 60 characters' });
		const auth = await getAuth();
		return (
			(await run(() =>
				auth.api.updateUser({
					headers: request.headers,
					body: { name }
				})
			)) ?? { renamed: true }
		);
	},

	delete: async ({ locals, request }) => {
		if (!locals.user) redirect(303, '/login');
		const confirmation = String((await request.formData()).get('confirm') ?? '').trim();
		const expected = locals.user.email;
		if (confirmation !== expected) {
			return fail(400, { error: `Type "${expected}" to confirm` });
		}
		const auth = await getAuth();
		const failed = await run(() =>
			auth.api.deleteUser({
				headers: request.headers,
				body: {}
			})
		);
		if (failed) return failed;
		await track({ distinctId: locals.user.id, event: 'deleted account' });
		redirect(303, '/');
	}
};
