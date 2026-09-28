import { fail } from '@sveltejs/kit';
import type { ApiKeyScope } from '@hans/db';
import { encryptSecret, decryptSecret } from '@hans/llm';
import {
	createApiKey,
	deleteMcpServer,
	getMcpServer,
	listApiKeys,
	listMcpServers,
	mcpListTools,
	revokeApiKey,
	saveMcpServer,
	type McpUrlPolicy
} from '@hans/mcp';
import { getContext } from '$lib/server/context';
import { requireOrganization } from '$lib/server/organization';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { organization } = await parent();
	const { db, env } = await getContext();
	const [keys, servers] = await Promise.all([
		listApiKeys(db, organization.id),
		listMcpServers(db, organization.id)
	]);
	const endpoint = `${env.APP_URL.replace(/\/+$/, '')}/api/mcp`;
	return {
		keys,
		servers,
		endpoint,
		allowPrivate: env.MCP_ALLOW_PRIVATE_URLS,
		cursorConfig: JSON.stringify(
			{
				mcpServers: {
					hansi: {
						type: 'http',
						url: endpoint,
						headers: { Authorization: 'Bearer hsk_…' }
					}
				}
			},
			null,
			2
		)
	};
};

function policy(env: { NODE_ENV: string; MCP_ALLOW_PRIVATE_URLS: boolean }): McpUrlPolicy {
	return {
		allowPrivate: env.MCP_ALLOW_PRIVATE_URLS,
		allowInsecureLocalhost: env.NODE_ENV !== 'production' || env.MCP_ALLOW_PRIVATE_URLS
	};
}

function scopesFrom(form: FormData): ApiKeyScope[] {
	return form
		.getAll('scopes')
		.map(String)
		.filter((scope): scope is ApiKeyScope => scope === 'read' || scope === 'write');
}

export const actions: Actions = {
	createKey: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		try {
			const { db } = await getContext();
			const created = await createApiKey(db, {
				organizationId: organization.id,
				name,
				scopes: scopesFrom(form),
				createdBy: locals.user?.id
			});
			return { createdKey: { name: created.name, secret: created.secret } };
		} catch (error) {
			return fail(400, { error: (error as Error).message });
		}
	},

	revokeKey: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const { db } = await getContext();
		await revokeApiKey(db, organization.id, String(form.get('keyId') ?? ''));
		return { revoked: true };
	},

	discover: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const formKey = String(form.get('formKey') ?? 'new');
		const url = String(form.get('url') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const guidance = String(form.get('guidance') ?? '');
		let token = String(form.get('token') ?? '').trim();
		try {
			const { db, env } = await getContext();
			if (!token && formKey !== 'new') {
				const server = await getMcpServer(db, organization.id, formKey);
				if (server?.encryptedToken) {
					token = await decryptSecret(
						server.encryptedToken,
						env.HANS_ENCRYPTION_KEY,
						`mcp_servers:${server.id}`
					);
				}
			}
			const tools = await mcpListTools({
				url,
				token: token || undefined,
				timeoutMs: 10_000,
				...policy(env)
			});
			return {
				discovered: {
					formKey,
					name,
					url,
					guidance,
					tools: tools.map((tool) => ({
						name: tool.name,
						description: tool.description.slice(0, 280)
					}))
				}
			};
		} catch (error) {
			return fail(400, { error: (error as Error).message, formKey });
		}
	},

	save: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const formKey = String(form.get('formKey') ?? 'new');
		const serverId = formKey === 'new' ? crypto.randomUUID() : formKey;
		const token = String(form.get('token') ?? '').trim();
		const clearToken = form.get('clearToken') === 'on';
		try {
			const { db, env } = await getContext();
			let encryptedToken: string | null | undefined;
			if (clearToken) encryptedToken = null;
			else if (token) {
				encryptedToken = await encryptSecret(
					token,
					env.HANS_ENCRYPTION_KEY,
					`mcp_servers:${serverId}`
				);
			}
			await saveMcpServer(
				db,
				{
					organizationId: organization.id,
					id: serverId,
					name: String(form.get('name') ?? ''),
					url: String(form.get('url') ?? ''),
					guidance: String(form.get('guidance') ?? ''),
					enabled: form.get('enabled') === 'on',
					allowedTools:
						form.get('toolsTouched') === '1'
							? form.getAll('tools').map(String)
							: formKey === 'new'
								? []
								: undefined,
					encryptedToken
				},
				policy(env)
			);
			return { saved: true };
		} catch (error) {
			return fail(400, { error: (error as Error).message, formKey });
		}
	},

	delete: async ({ locals, request }) => {
		const organization = await requireOrganization(locals, request.headers);
		const form = await request.formData();
		const formKey = String(form.get('formKey') ?? '');
		if (!formKey || formKey === 'new') return fail(400, { error: 'Nothing to delete' });
		const { db } = await getContext();
		await deleteMcpServer(db, organization.id, formKey);
		return { deleted: true };
	}
};
