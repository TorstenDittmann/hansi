import { expect, test } from 'bun:test';
import { buildTrace, formatMs, traceItem, type TraceEvent } from './trace';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
let nextId = 1;
const event = (type: string, data: Record<string, unknown> | null, seconds = 0): TraceEvent => ({
	id: nextId++,
	type,
	data,
	createdAt: at(seconds)
});

test('shows a command by its first line and keeps the full text for the details', () => {
	const item = traceItem(
		event('tool.run_command', {
			command: "python3 - <<'PY'\nprint(1)\nPY",
			exitCode: 2,
			timedOut: false,
			ms: 620
		}),
		at(0).getTime()
	);
	expect(item.label).toBe('Run command');
	expect(item.summary).toBe("python3 - <<'PY' …");
	expect(item.code).toContain('print(1)');
	expect(item.meta).toEqual(['exit 2', '620ms']);
	expect(item.tone).toBe('error');
});

test('shows a file read as a path with its line range', () => {
	const item = traceItem(
		event('tool.read_file', { path: 'composer.lock', startLine: 200, endLine: 250 }),
		0
	);
	expect(item.summary).toBe('composer.lock:200-250');
	expect(item.mono).toBe(true);
});

test('falls back to the plain fields for an unknown event type', () => {
	const item = traceItem(event('something.new', { count: 3, nested: { a: 1 }, agent: 'x' }), 0);
	expect(item.label).toBe('something.new');
	expect(item.summary).toBe('count: 3');
});

test('folds interleaved subagent steps under the subagent that ran them', () => {
	const entries = buildTrace([
		event('review.mode', { incremental: false, from: '1b4fb5003d6c' }, 0),
		event('subagent.started', { task: 'Check A', paths: ['a.ts'], agent: 'sub-1' }, 1),
		event('subagent.started', { task: 'Check B', paths: [], agent: 'sub-2' }, 2),
		event('tool.grep', { pattern: 'foo', agent: 'sub-1' }, 3),
		event('tool.grep', { pattern: 'bar', agent: 'sub-2' }, 4),
		event('subagent.completed', { findings: 1, ms: 5000, agent: 'sub-1' }, 6),
		event('tool.read_file', { path: 'b.ts', startLine: 1 }, 7)
	]);
	expect(entries.map((e) => (e.kind === 'event' ? e.item.type : `subagent ${e.agent}`))).toEqual([
		'review.mode',
		'subagent sub-1',
		'subagent sub-2',
		'tool.read_file'
	]);
	const [, first, second, last] = entries;
	if (first.kind !== 'subagent' || second.kind !== 'subagent') throw new Error('expected groups');
	expect(first.items.map((i) => i.summary)).toEqual(['foo']);
	expect(first.end?.summary).toBe('1 finding');
	expect(second.items.map((i) => i.summary)).toEqual(['bar']);
	expect(second.end).toBeUndefined();
	if (last.kind !== 'event') throw new Error('expected event');
	expect(last.item.offset).toBe(7);
});

test('carries a rounded-up second into the minutes', () => {
	expect(formatMs(620)).toBe('620ms');
	expect(formatMs(4439)).toBe('4.4s');
	expect(formatMs(59_960)).toBe('1m 0s');
	expect(formatMs(119_600)).toBe('2m 0s');
	expect(formatMs(144_229)).toBe('2m 24s');
});
