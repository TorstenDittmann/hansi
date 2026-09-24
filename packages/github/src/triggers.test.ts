import { expect, test } from 'bun:test';
import { canTriggerFromComment } from './triggers';

const slug = 'hansi-codes';

test('trusted humans can trigger', () => {
	for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
		expect(
			canTriggerFromComment(
				{ user: { login: 'alice', type: 'User' }, author_association: association },
				slug
			)
		).toBe(true);
	}
});

test('untrusted humans cannot trigger', () => {
	for (const association of ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE']) {
		expect(
			canTriggerFromComment(
				{ user: { login: 'outsider', type: 'User' }, author_association: association },
				slug
			)
		).toBe(false);
	}
});

test('other bots can trigger even with NONE association', () => {
	expect(
		canTriggerFromComment(
			{ user: { login: 'cursor[bot]', type: 'Bot' }, author_association: 'NONE' },
			slug
		)
	).toBe(true);
});

test('our own bot cannot trigger', () => {
	expect(
		canTriggerFromComment(
			{ user: { login: 'hansi-codes[bot]', type: 'Bot' }, author_association: 'NONE' },
			slug
		)
	).toBe(false);
	expect(
		canTriggerFromComment(
			{ user: { login: 'hansi-codes', type: 'Bot' }, author_association: 'NONE' },
			slug
		)
	).toBe(false);
});
