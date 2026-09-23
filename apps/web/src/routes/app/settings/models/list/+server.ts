import { error, json } from '@sveltejs/kit';
import { schema } from '@hans/db';
import { decryptSecret, listModels } from '@hans/llm';
import { and, eq } from 'drizzle-orm';
import { getContext } from '$lib/server/context';
import { requireOrganization } from '$lib/server/organization';
import type { RequestHandler } from './$types';

/** The models a stored key can use, for the model picker. */
export const GET: RequestHandler = async ({ locals, request, url }) => {
	const organization = await requireOrganization(locals, request.headers);
	const { db, env } = await getContext();
	const [credential] = await db
		.select()
		.from(schema.providerCredentials)
		.where(
			and(
				eq(schema.providerCredentials.id, url.searchParams.get('credential') ?? ''),
				eq(schema.providerCredentials.organizationId, organization.id)
			)
		);
	if (!credential) error(404, 'Unknown key');

	try {
		const apiKey = await decryptSecret(
			credential.encryptedKey,
			env.HANS_ENCRYPTION_KEY,
			`provider_credentials:${credential.id}`
		);
		return json(
			await listModels({
				provider: credential.provider,
				apiKey,
				baseUrl: credential.baseUrl,
				region: credential.region
			})
		);
	} catch (err) {
		error(502, (err as Error).message);
	}
};
