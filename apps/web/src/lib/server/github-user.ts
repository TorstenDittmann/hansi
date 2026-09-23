import { error } from '@sveltejs/kit';
import { schema } from '@hans/db';
import { and, eq } from 'drizzle-orm';
import { getAuth } from './auth';
import { getContext } from './context';

/** The signed-in user's GitHub access token; better-auth refreshes it when expired. */
export async function getGitHubUserToken(userId: string, headers: Headers): Promise<string> {
	const { db } = await getContext();
	const [account] = await db
		.select({ id: schema.account.id })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'github')));
	if (!account) error(403, 'No GitHub account linked');

	const auth = await getAuth();
	const { accessToken } = await auth.api.getAccessToken({
		headers,
		body: { accountId: account.id }
	});
	return accessToken;
}
