/**
 * How much a model thinks before it answers. These are the levels the AI SDK accepts on
 * `generateText({ reasoning })`. Absent means the provider's own default.
 */
export const reasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

export const reasoningEffortLabel: Record<ReasoningEffort, string> = {
	none: 'None',
	minimal: 'Minimal',
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	xhigh: 'Extra high'
};

/**
 * Parses a stored or submitted effort. `null` means "provider default" (empty input).
 * `undefined` means the value is not a known level.
 */
export function parseReasoningEffort(value: unknown): ReasoningEffort | null | undefined {
	if (value == null || value === '') return null;
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return (reasoningEfforts as readonly string[]).includes(trimmed)
		? (trimmed as ReasoningEffort)
		: undefined;
}
