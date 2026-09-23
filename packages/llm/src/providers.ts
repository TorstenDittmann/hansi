import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

export const providerIds = [
	'openai',
	'anthropic',
	'xai',
	'google',
	'openrouter',
	'amazon-bedrock',
	'openai-compatible'
] as const;
export type ProviderId = (typeof providerIds)[number];

export interface ProviderInfo {
	id: ProviderId;
	name: string;
	defaultBaseUrl: string;
	/** OpenAI-compatible endpoints (Ollama, vLLM, LiteLLM, Groq, …) need an explicit base URL. */
	requiresBaseUrl: boolean;
	/** AWS providers need a region instead of a base URL. */
	requiresRegion?: boolean;
	/** Provider id on models.dev, used for pricing lookups. */
	modelsDevId?: string;
	keyUrl?: string;
}

export const providers: Record<ProviderId, ProviderInfo> = {
	openai: {
		id: 'openai',
		name: 'OpenAI',
		defaultBaseUrl: 'https://api.openai.com/v1',
		requiresBaseUrl: false,
		modelsDevId: 'openai',
		keyUrl: 'https://platform.openai.com/api-keys'
	},
	anthropic: {
		id: 'anthropic',
		name: 'Anthropic',
		defaultBaseUrl: 'https://api.anthropic.com/v1',
		requiresBaseUrl: false,
		modelsDevId: 'anthropic',
		keyUrl: 'https://console.anthropic.com/settings/keys'
	},
	xai: {
		id: 'xai',
		name: 'xAI',
		defaultBaseUrl: 'https://api.x.ai/v1',
		requiresBaseUrl: false,
		modelsDevId: 'xai',
		keyUrl: 'https://console.x.ai'
	},
	google: {
		id: 'google',
		name: 'Google Gemini',
		defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
		requiresBaseUrl: false,
		modelsDevId: 'google',
		keyUrl: 'https://aistudio.google.com/apikey'
	},
	openrouter: {
		id: 'openrouter',
		name: 'OpenRouter',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		requiresBaseUrl: false,
		modelsDevId: 'openrouter',
		keyUrl: 'https://openrouter.ai/keys'
	},
	'amazon-bedrock': {
		id: 'amazon-bedrock',
		name: 'Amazon Bedrock',
		defaultBaseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
		requiresBaseUrl: false,
		requiresRegion: true,
		modelsDevId: 'amazon-bedrock',
		keyUrl: 'https://console.aws.amazon.com/bedrock/home#/api-keys'
	},
	'openai-compatible': {
		id: 'openai-compatible',
		name: 'OpenAI-compatible',
		defaultBaseUrl: 'http://localhost:11434/v1',
		requiresBaseUrl: true
	}
};

export interface ProviderCredential {
	provider: ProviderId;
	apiKey: string;
	baseUrl?: string | null;
	/** AWS region, for Amazon Bedrock. */
	region?: string | null;
}

export type BedrockAuth =
	| { kind: 'api-key'; apiKey: string }
	| { kind: 'iam'; accessKeyId: string; secretAccessKey: string; sessionToken?: string };

/**
 * Bedrock accepts a Bedrock API key, or IAM credentials entered as
 * `ACCESS_KEY_ID:SECRET_ACCESS_KEY[:SESSION_TOKEN]` (recognized by the AKIA/ASIA prefix).
 */
export function parseBedrockKey(key: string): BedrockAuth {
	const iam = /^((?:AKIA|ASIA)[A-Z0-9]{12,}):([^:]+)(?::(.+))?$/.exec(key.trim());
	if (!iam) return { kind: 'api-key', apiKey: key.trim() };
	return {
		kind: 'iam',
		accessKeyId: iam[1]!,
		secretAccessKey: iam[2]!,
		...(iam[3] ? { sessionToken: iam[3] } : {})
	};
}

export function createLanguageModel(
	credential: ProviderCredential,
	modelId: string
): LanguageModel {
	const baseURL = credential.baseUrl || undefined;
	const apiKey = credential.apiKey;

	switch (credential.provider) {
		case 'openai':
			return createOpenAI({ apiKey, baseURL })(modelId);
		case 'anthropic':
			return createAnthropic({ apiKey, baseURL })(modelId);
		case 'xai':
			return createXai({ apiKey, baseURL })(modelId);
		case 'google':
			return createGoogle({ apiKey, baseURL })(modelId);
		case 'openrouter':
			return createOpenRouter({ apiKey, baseURL })(modelId);
		case 'amazon-bedrock': {
			if (!credential.region) throw new Error('Amazon Bedrock requires a region');
			const auth = parseBedrockKey(apiKey);
			const keys =
				auth.kind === 'api-key'
					? { apiKey: auth.apiKey }
					: {
							accessKeyId: auth.accessKeyId,
							secretAccessKey: auth.secretAccessKey,
							sessionToken: auth.sessionToken
						};
			return createAmazonBedrock({ region: credential.region, baseURL, ...keys })(modelId);
		}
		case 'openai-compatible':
			if (!baseURL) throw new Error('OpenAI-compatible providers require a base URL');
			return createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })(modelId);
	}
}
