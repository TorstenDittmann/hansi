import { generateText, isStepCount, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { parseUnifiedDiff, renderFileDiff } from './diff';
import { filterFiles } from './filters';
import { chatInstructions } from './prompts';
import type { ModelCall, ReviewModel } from './review';
import { createRepoTools, loadRepoGuidelines, type EmitEvent, type TrustedSource } from './tools';

export interface ThreadMessage {
	author: string;
	body: string;
	/** True for messages Hansi wrote. */
	fromBot: boolean;
}

export interface ChatInput {
	repoDir: string;
	pullRequest: { title: string; body: string; author: string };
	/** Full PR diff, for context. */
	diff: string;
	/** Conversation so far, oldest first; the last message is the one to answer. */
	thread: ThreadMessage[];
	/** Set when the conversation is attached to a line of code. */
	focus?: { path: string; line?: number; diffHunk?: string };
	learnings: string[];
	language: string;
	/** Where to read repository guidelines from; defaults to the (untrusted) PR checkout. */
	trustedSource?: TrustedSource;
	model: ReviewModel;
	/** Stores a team preference for future reviews. */
	onRemember: (rule: string) => Promise<void>;
	/** Available when the thread started from a Hansi finding. */
	onMarkFinding?: (status: 'resolved' | 'dismissed', reason: string) => Promise<void>;
	onEvent?: EmitEvent;
	onModelCall?: (call: ModelCall) => void | Promise<void>;
	signal?: AbortSignal;
}

const MAX_DIFF_CHARS = 60_000;

/** Answers a question in a pull request conversation. Returns the reply as Markdown. */
export async function runChat(input: ChatInput): Promise<string> {
	const emit: EmitEvent = input.onEvent ?? (() => {});
	const tools: ToolSet = {
		...createRepoTools(input.repoDir, emit),
		remember: tool({
			description:
				'Save a lasting team preference for future reviews of this repository, e.g. "Do not flag missing error handling in scripts/". Only use when the user states a durable rule, not for one-off decisions.',
			inputSchema: z.object({
				rule: z.string().describe('One imperative sentence, understandable without this thread')
			}),
			execute: async ({ rule }) => {
				emit({ type: 'chat.remember', data: { rule } });
				await input.onRemember(rule);
				return 'Saved. Future reviews will follow this.';
			}
		})
	};
	if (input.onMarkFinding) {
		const onMarkFinding = input.onMarkFinding;
		tools.mark_finding = tool({
			description:
				'Record the outcome of the finding this thread is about: resolved (the author fixed it) or dismissed (it was wrong or not wanted).',
			inputSchema: z.object({
				status: z.enum(['resolved', 'dismissed']),
				reason: z.string()
			}),
			execute: async ({ status, reason }) => {
				emit({ type: 'chat.mark_finding', data: { status, reason } });
				await onMarkFinding(status, reason);
				return `Marked as ${status}.`;
			}
		});
	}

	let diff = filterFiles(parseUnifiedDiff(input.diff)).included.map(renderFileDiff).join('\n\n');
	if (diff.length > MAX_DIFF_CHARS) {
		diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated; use the tools to read files.`;
	}

	const parts = [
		`<pull_request author="${input.pullRequest.author}">\n<title>${input.pullRequest.title}</title>\n<description>\n${input.pullRequest.body || '(none)'}\n</description>\n</pull_request>`
	];
	const guidelines = await loadRepoGuidelines(input.repoDir, input.trustedSource);
	if (guidelines) parts.push(`<repository_guidelines>\n${guidelines}\n</repository_guidelines>`);
	if (input.learnings.length) {
		parts.push(
			`<team_learnings>\n${input.learnings.map((l) => `- ${l}`).join('\n')}\n</team_learnings>`
		);
	}
	parts.push(`<diff>\n${diff}\n</diff>`);
	if (input.focus) {
		parts.push(
			`<code_location path="${input.focus.path}"${input.focus.line ? ` line="${input.focus.line}"` : ''}>\n${input.focus.diffHunk ?? ''}\n</code_location>`
		);
	}
	parts.push(
		`<conversation>\n${input.thread
			.map(
				(m) =>
					`<message author="${m.author}"${m.fromBot ? ' bot="true"' : ''}>\n${m.body}\n</message>`
			)
			.join('\n')}\n</conversation>`
	);

	const started = performance.now();
	const result = await generateText({
		model: input.model.model,
		instructions: chatInstructions(input.language, !!input.onMarkFinding),
		prompt: parts.join('\n\n'),
		tools,
		stopWhen: isStepCount(20),
		abortSignal: input.signal
	});
	await input.onModelCall?.({
		role: 'chat',
		provider: input.model.provider,
		modelId: input.model.modelId,
		usage: result.usage,
		durationMs: Math.round(performance.now() - started)
	});

	return result.text.trim() || "Sorry, I couldn't come up with an answer to that.";
}
