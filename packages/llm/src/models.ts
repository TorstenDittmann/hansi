import { providers, type ProviderCredential } from './providers';

export interface ModelSummary {
	id: string;
	name?: string;
}

/**
 * Lists the models a credential can access. Doubles as the "test connection" check:
 * it throws with the provider's error message when the key is rejected.
 */
export async function listModels(
	credential: ProviderCredential,
	fetchImpl: typeof fetch = fetch
): Promise<ModelSummary[]> {
	const base = (credential.baseUrl || providers[credential.provider].defaultBaseUrl).replace(
		/\/+$/,
		''
	);
	const headers: Record<string, string> = {};
	let url = `${base}/models`;

	switch (credential.provider) {
		case 'anthropic':
			headers['x-api-key'] = credential.apiKey;
			headers['anthropic-version'] = '2023-06-01';
			url += '?limit=1000';
			break;
		case 'google':
			headers['x-goog-api-key'] = credential.apiKey;
			url += '?pageSize=1000';
			break;
		default:
			if (credential.apiKey) headers.authorization = `Bearer ${credential.apiKey}`;
	}

	const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(
			`${providers[credential.provider].name} returned ${response.status}: ${body.slice(0, 300)}`
		);
	}

	const json = (await response.json()) as {
		data?: { id: string; name?: string; display_name?: string }[];
		models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
	};

	if (credential.provider === 'google') {
		return (json.models ?? [])
			.filter((model) => model.supportedGenerationMethods?.includes('generateContent') ?? true)
			.map((model) => ({ id: model.name.replace(/^models\//, ''), name: model.displayName }));
	}

	return (json.data ?? [])
		.map((model) => ({ id: model.id, name: model.display_name ?? model.name }))
		.sort((a, b) => a.id.localeCompare(b.id));
}
