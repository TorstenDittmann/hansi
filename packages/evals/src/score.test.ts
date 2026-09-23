import { expect, test } from 'bun:test';
import { cases } from './cases';
import { scoreCase, summarize } from './score';

const expected = [
	{ path: 'a.ts', lines: [10, 12] as [number, number], description: 'off by one' },
	{ path: 'b.ts', lines: [3, 3] as [number, number], description: 'missing await' }
];
const at = (path: string, line: number) => ({ path, startLine: line, endLine: line, title: 't' });

test('credits findings near the expected lines once', () => {
	const score = scoreCase(expected, [at('a.ts', 13), at('a.ts', 11), at('c.ts', 1)]);
	expect(score.truePositives).toBe(1);
	expect(score.falsePositives).toBe(2); // the duplicate on a.ts and the unrelated c.ts comment
	expect(score.falseNegatives).toBe(1);
	expect(score.missed.map((m) => m.description)).toEqual(['missing await']);
});

test('comments outside the tolerance do not count', () => {
	expect(scoreCase(expected, [at('a.ts', 20)]).truePositives).toBe(0);
});

test('summarize computes precision, recall and F1', () => {
	const perfect = summarize([scoreCase(expected, [at('a.ts', 10), at('b.ts', 3)])]);
	expect(perfect).toEqual({ precision: 1, recall: 1, f1: 1 });

	const half = summarize([scoreCase(expected, [at('a.ts', 10), at('z.ts', 1)])]);
	expect(half.precision).toBe(0.5);
	expect(half.recall).toBe(0.5);
});

test('silence on clean changes is perfect precision', () => {
	expect(summarize([scoreCase([], [])])).toEqual({ precision: 1, recall: 1, f1: 1 });
	expect(summarize([scoreCase([], [at('a.ts', 1)])]).precision).toBe(0);
});

test('every case is well-formed', () => {
	const names = new Set<string>();
	for (const c of cases) {
		expect(names.has(c.name)).toBe(false);
		names.add(c.name);
		expect(Object.keys(c.head).length).toBeGreaterThan(0);
		for (const e of c.expected) {
			const content = c.head[e.path];
			expect(content, `${c.name}: ${e.path} must be changed by the PR`).toBeString();
			const lineCount = content!.split('\n').length;
			expect(e.lines[1], `${c.name}: lines within ${e.path}`).toBeLessThanOrEqual(lineCount);
			expect(e.lines[0]).toBeLessThanOrEqual(e.lines[1]);
		}
	}
});
