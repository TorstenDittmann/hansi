import { expect, test } from 'bun:test';
import {
	createSandboxTools,
	formatCommandResult,
	truncateOutput,
	type CommandRunner,
	type ReviewEvent
} from './index';

const run = (tools: ReturnType<typeof createSandboxTools>, input: object) =>
	tools.run_command.execute!(
		input as never,
		{ toolCallId: 't', messages: [] } as never
	) as Promise<string>;

test('run_command passes the command and timeout to the runner and formats the result', async () => {
	const calls: { command: string; timeoutMs: number }[] = [];
	const events: ReviewEvent[] = [];
	const runner: CommandRunner = {
		run: async (command, { timeoutMs }) => {
			calls.push({ command, timeoutMs });
			return { exitCode: 1, stdout: '1 failed\n', stderr: '', timedOut: false };
		}
	};
	const tools = createSandboxTools(runner, (event) => events.push(event));

	const output = await run(tools, { command: 'bun test src/math.test.ts', timeoutSeconds: 30 });

	expect(calls).toEqual([{ command: 'bun test src/math.test.ts', timeoutMs: 30_000 }]);
	expect(output).toBe('Exit code 1\n\nstdout:\n1 failed');
	expect(events[0]).toMatchObject({
		type: 'tool.run_command',
		data: { command: 'bun test src/math.test.ts', exitCode: 1, timedOut: false }
	});
});

test('run_command reports runner errors to the model instead of throwing', async () => {
	const runner: CommandRunner = {
		run: async () => {
			throw new Error('sandbox is gone');
		}
	};
	const output = await run(
		createSandboxTools(runner, () => {}),
		{ command: 'ls' }
	);
	expect(output).toBe('Error: sandbox is gone');
});

test('formatCommandResult names timeouts and empty output', () => {
	expect(formatCommandResult({ exitCode: null, stdout: '', stderr: '', timedOut: true })).toBe(
		'Timed out\n\nNo output.'
	);
	expect(formatCommandResult({ exitCode: 0, stdout: '', stderr: 'warn\n', timedOut: false })).toBe(
		'Exit code 0\n\nstderr:\nwarn'
	);
});

test('truncateOutput keeps the start and the end', () => {
	const text = `${'a'.repeat(50)}${'b'.repeat(50)}`;
	const cut = truncateOutput(text, 20);
	expect(cut.startsWith('a'.repeat(10))).toBe(true);
	expect(cut.endsWith('b'.repeat(10))).toBe(true);
	expect(cut).toContain('80 characters cut');
	expect(truncateOutput('short', 20)).toBe('short');
});
