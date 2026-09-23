import { AwsClient } from 'aws4fetch';
import { parseBedrockKey, providers, type ProviderCredential } from './providers';

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
	if (credential.provider === 'amazon-bedrock') return listBedrockModels(credential, fetchImpl);

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

/**
 * Bedrock: inference profiles first (newer models can only be invoked through one, e.g.
 * `us.anthropic...`), then on-demand foundation models. IAM keys are SigV4-signed; Bedrock API
 * keys are sent as a bearer token.
 */
async function listBedrockModels(
	credential: ProviderCredential,
	fetchImpl: typeof fetch
): Promise<ModelSummary[]> {
	const region = credential.region;
	if (!region) throw new Error('Amazon Bedrock requires a region');
	const auth = parseBedrockKey(credential.apiKey);
	const signer =
		auth.kind === 'iam'
			? new AwsClient({
					accessKeyId: auth.accessKeyId,
					secretAccessKey: auth.secretAccessKey,
					sessionToken: auth.sessionToken,
					region,
					service: 'bedrock'
				})
			: null;

	const get = async (path: string) => {
		const url = `https://bedrock.${region}.amazonaws.com${path}`;
		const init: RequestInit = { signal: AbortSignal.timeout(15_000) };
		const request = signer
			? await signer.sign(url, init)
			: new Request(url, {
					...init,
					headers: { authorization: `Bearer ${auth.kind === 'api-key' ? auth.apiKey : ''}` }
				});
		const response = await fetchImpl(request);
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(`Amazon Bedrock returned ${response.status}: ${body.slice(0, 300)}`);
		}
		return response.json();
	};

	const [profiles, foundation] = (await Promise.all([
		get('/inference-profiles?maxResults=1000'),
		get('/foundation-models?byOutputModality=TEXT&byInferenceType=ON_DEMAND')
	])) as [
		{ inferenceProfileSummaries?: { inferenceProfileId: string; inferenceProfileName?: string }[] },
		{ modelSummaries?: { modelId: string; modelName?: string }[] }
	];
	return [
		...(profiles.inferenceProfileSummaries ?? []).map((p) => ({
			id: p.inferenceProfileId,
			name: p.inferenceProfileName
		})),
		...(foundation.modelSummaries ?? []).map((m) => ({ id: m.modelId, name: m.modelName }))
	];
}
