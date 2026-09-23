import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { runChat } from './chat';

let repoDir: string;
beforeAll(async () => {
	repoDir = await mkdtemp(join(tmpdir(), 'hans-chat-'));
	await writeFile(join(repoDir, 'a.ts'), 'export const a = 1;\n');
});
afterAll(() => rm(repoDir, { recursive: true, force: true }));

const usage = {
	inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 10, text: 10, reasoning: 0 }
};
type MockOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>;
type GenerateResult = Extract<NonNullable<MockOptions['doGenerate']>, unknown[]>[number];

const step = (
	content: GenerateResult['content'],
	unified: 'tool-calls' | 'stop'
): GenerateResult => ({
	content,
	finishReason: { unified, raw: unified },
	usage,
	warnings: []
});
const call = (toolName: string, input: unknown) => ({
	type: 'tool-call' as const,
	toolCallId: toolName,
	toolName,
	input: JSON.stringify(input)
});

test('answers, remembers preferences, and records finding outcomes', async () => {
	const model = new MockLanguageModelV4({
		doGenerate: [
			step(
				[
					call('read_file', { path: 'a.ts' }),
					call('remember', { rule: 'Do not flag magic numbers in config files.' }),
					call('mark_finding', { status: 'dismissed', reason: 'Intentional constant' })
				],
				'tool-calls'
			),
			step([{ type: 'text' as const, text: 'Got it, I will skip those from now on.' }], 'stop')
		]
	});

	const remembered: string[] = [];
	const marked: string[] = [];
	const roles: string[] = [];
	const reply = await runChat({
		repoDir,
		pullRequest: { title: 'Config', body: '', author: 'octocat' },
		diff: '',
		thread: [
			{ author: 'hans', body: 'Magic number on line 1.', fromBot: true },
			{ author: 'octocat', body: 'That is intentional, we never care about this.', fromBot: false }
		],
		focus: { path: 'a.ts', line: 1 },
		learnings: ['Prefer early returns.'],
		language: 'en',
		model: { model, provider: 'mock', modelId: 'mock-1' },
		onRemember: async (rule) => void remembered.push(rule),
		onMarkFinding: async (status) => void marked.push(status),
		onModelCall: (c) => void roles.push(c.role)
	});

	expect(reply).toBe('Got it, I will skip those from now on.');
	expect(remembered).toEqual(['Do not flag magic numbers in config files.']);
	expect(marked).toEqual(['dismissed']);
	expect(roles).toEqual(['chat']);
	const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
	expect(prompt).toContain('Prefer early returns.');
	expect(prompt).toContain('That is intentional');
	// The tool result of read_file is fed back to the model on the second step.
	expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('export const a = 1;');
});

test('mark_finding is only offered for threads about a finding', async () => {
	const model = new MockLanguageModelV4({
		doGenerate: [step([{ type: 'text' as const, text: 'It returns 1.' }], 'stop')]
	});
	await runChat({
		repoDir,
		pullRequest: { title: 'x', body: '', author: 'octocat' },
		diff: '',
		thread: [{ author: 'octocat', body: '@hans what does a return?', fromBot: false }],
		learnings: [],
		language: 'en',
		model: { model, provider: 'mock', modelId: 'mock-1' },
		onRemember: async () => {}
	});
	const toolNames = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name);
	expect(toolNames).toContain('remember');
	expect(toolNames).not.toContain('mark_finding');
});
