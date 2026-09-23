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
	'openai-compatible'
] as const;
export type ProviderId = (typeof providerIds)[number];

export interface ProviderInfo {
	id: ProviderId;
	name: string;
	defaultBaseUrl: string;
	/** OpenAI-compatible endpoints (Ollama, vLLM, LiteLLM, Groq, …) need an explicit base URL. */
	requiresBaseUrl: boolean;
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
		case 'openai-compatible':
			if (!baseURL) throw new Error('OpenAI-compatible providers require a base URL');
			return createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })(modelId);
	}
}
