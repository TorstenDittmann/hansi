import { expect, test } from 'bun:test';
import { classifyMention } from './mentions';

test('classifies review requests, questions, and non-mentions', () => {
	expect(classifyMention('@hans-ab12 review', 'hans-ab12')).toBe('review');
	expect(classifyMention('Could you @HANS-AB12 Review this again?', 'hans-ab12')).toBe('review');
	expect(classifyMention('@hans-ab12 why is this a bug?', 'hans-ab12')).toBe('chat');
	expect(classifyMention('thanks @hans-ab12', 'hans-ab12')).toBe('chat');
	expect(classifyMention('no mention here', 'hans-ab12')).toBeNull();
});

test('requires the exact handle', () => {
	expect(classifyMention('@hans-ab123 review', 'hans-ab12')).toBeNull();
	expect(classifyMention('@hans review', 'hans-ab12')).toBeNull();
});

test('ignores mentions in code and quotes', () => {
	expect(classifyMention('Run `@hans-ab12 review` to retry', 'hans-ab12')).toBeNull();
	expect(classifyMention('```\n@hans-ab12 review\n```', 'hans-ab12')).toBeNull();
	expect(classifyMention('> @hans-ab12 review\nquoted', 'hans-ab12')).toBeNull();
});
