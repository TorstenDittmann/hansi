import { expect, test } from 'bun:test';
import { commentableLines, parseUnifiedDiff } from '@hans/core';
import { cases } from './cases';
import { buildCaseRepository } from './repo';

// An expected finding on a line GitHub can't comment on could never be found. Guard every case.
for (const evalCase of cases) {
	test(`${evalCase.name}: expected findings are on commentable lines`, async () => {
		const repo = await buildCaseRepository(evalCase);
		try {
			const files = parseUnifiedDiff(repo.diff);
			expect(files.length).toBeGreaterThan(0);
			for (const expected of evalCase.expected) {
				const file = files.find((f) => f.path === expected.path);
				expect(file, `${expected.path} is in the diff`).toBeDefined();
				const lines = commentableLines(file!);
				const [start, end] = expected.lines;
				const reachable = Array.from({ length: end - start + 1 }, (_, i) => start + i).some(
					(line) => lines.has(line)
				);
				expect(reachable, `${expected.path}:${start}-${end} is commentable`).toBe(true);
			}
		} finally {
			await repo.cleanup();
		}
	});
}
