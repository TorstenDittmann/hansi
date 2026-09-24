import { APICallError, RetryError, type LanguageModelUsage } from 'ai';

/** A model call that finished: what it used, for cost tracking. */
export interface ModelCall {
	role: 'review' | 'verify' | 'chat';
	provider: string;
	modelId: string;
	usage: LanguageModelUsage;
	durationMs: number;
}

/** A model call that failed, e.g. a rate limit, timeout, or rejected key. */
export interface ModelFailure {
	role: ModelCall['role'];
	provider: string;
	modelId: string;
	durationMs: number;
	message: string;
	/** HTTP status from the provider, when there was a response. */
	status?: number;
}

export interface ModelCallHooks {
	onModelCall?: (call: ModelCall) => void | Promise<void>;
	onModelError?: (failure: ModelFailure) => void | Promise<void>;
	signal?: AbortSignal;
}

/**
 * Runs one model call and reports it: its usage when it finishes, or the error when it fails
 * (then rethrows). Calls cancelled through `signal` are not reported as failures.
 */
export async function callModel<T extends { usage: LanguageModelUsage }>(
	role: ModelCall['role'],
	model: { provider: string; modelId: string },
	hooks: ModelCallHooks,
	run: () => Promise<T>
): Promise<T> {
	const started = performance.now();
	const durationMs = () => Math.round(performance.now() - started);
	const { provider, modelId } = model;
	let result: T;
	try {
		result = await run();
	} catch (error) {
		if (!hooks.signal?.aborted) {
			await Promise.resolve(
				hooks.onModelError?.({
					role,
					provider,
					modelId,
					durationMs: durationMs(),
					...describeModelError(error)
				})
			).catch(() => {});
		}
		throw error;
	}
	await hooks.onModelCall?.({
		role,
		provider,
		modelId,
		usage: result.usage,
		durationMs: durationMs()
	});
	return result;
}

/** The message and HTTP status of a model error, looking through the SDK's retry wrapper. */
export function describeModelError(error: unknown): { message: string; status?: number } {
	const cause = RetryError.isInstance(error) ? (error.lastError ?? error) : error;
	const message = (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
	return APICallError.isInstance(cause) && cause.statusCode
		? { message, status: cause.statusCode }
		: { message };
}
