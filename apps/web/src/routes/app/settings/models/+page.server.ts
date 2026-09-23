import { fail } from '@sveltejs/kit';
import { schema, type ModelRole } from '@hans/db';
import { decryptSecret, listModels, providerIds, providers, type ProviderId } from '@hans/llm';
import { and, eq } from 'drizzle-orm';
import { getContext } from '$lib/server/context';
import {
	addCredential,
	clearModelAssignment,
	deleteCredential,
	listCredentials,
	listModelAssignments,
	setModelAssignment
} from '$lib/server/data';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organization } = await parent();
	const [credentials, assignments] = await Promise.all([
		listCredentials(organization.id),
		listModelAssignments(organization.id)
	]);
	return {
		credentials,
		assignments,
		providers: providerIds.map((id) => providers[id])
	};
};

const roles: ModelRole[] = ['review', 'verify'];

export const actions: Actions = {
	/** Validates the key against the provider's model list before storing it. */
	add: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const provider = String(form.get('provider')) as ProviderId;
		const apiKey = String(form.get('apiKey') ?? '').trim();
		const baseUrl = String(form.get('baseUrl') ?? '').trim() || undefined;
		const region = String(form.get('region') ?? '').trim() || undefined;
		const label = String(form.get('label') ?? '').trim() || providers[provider]?.name;

		if (!providerIds.includes(provider)) return fail(400, { error: 'Unknown provider' });
		if (providers[provider].requiresBaseUrl && !baseUrl) {
			return fail(400, { error: 'This provider needs a base URL' });
		}
		if (providers[provider].requiresRegion && !region) {
			return fail(400, { error: 'Amazon Bedrock needs a region, e.g. us-east-1' });
		}
		if (region && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) {
			return fail(400, { error: 'Region should look like us-east-1' });
		}
		if (baseUrl && !URL.canParse(baseUrl))
			return fail(400, { error: 'Base URL is not a valid URL' });
		if (!apiKey && provider !== 'openai-compatible')
			return fail(400, { error: 'API key is required' });

		try {
			await listModels({ provider, apiKey, baseUrl, region });
		} catch (err) {
			return fail(400, { error: `Connection test failed: ${(err as Error).message}` });
		}
		await addCredential(organization.id, { provider, label: label!, apiKey, baseUrl, region });
		return { added: true };
	},

	delete: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		await deleteCredential(organization.id, String(form.get('credentialId')));
	},

	/** Lists models for a stored credential, to fill the model picker. */
	models: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const credentialId = String(form.get('credentialId'));
		const { db, env } = await getContext();
		const [credential] = await db
			.select()
			.from(schema.providerCredentials)
			.where(
				and(
					eq(schema.providerCredentials.id, credentialId),
					eq(schema.providerCredentials.organizationId, organization.id)
				)
			);
		if (!credential) return fail(404, { error: 'Unknown credential' });

		try {
			const apiKey = await decryptSecret(
				credential.encryptedKey,
				env.HANS_ENCRYPTION_KEY,
				`provider_credentials:${credential.id}`
			);
			const models = await listModels({
				provider: credential.provider,
				apiKey,
				baseUrl: credential.baseUrl,
				region: credential.region
			});
			return { credentialId, models };
		} catch (err) {
			return fail(400, { error: (err as Error).message });
		}
	},

	assign: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const role = String(form.get('role')) as ModelRole;
		const credentialId = String(form.get('credentialId') ?? '');
		const modelId = String(form.get('modelId') ?? '').trim();
		if (!roles.includes(role)) return fail(400, { error: 'Unknown role' });

		if (!credentialId || !modelId) {
			if (role === 'review') return fail(400, { error: 'The review role needs a model' });
			await clearModelAssignment(organization.id, role);
			return { assigned: role };
		}
		try {
			await setModelAssignment(organization.id, role, credentialId, modelId);
		} catch (err) {
			return fail(400, { error: (err as Error).message });
		}
		return { assigned: role };
	}
};
