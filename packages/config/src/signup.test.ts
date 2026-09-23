import { expect, test } from 'bun:test';
import { canSignUp } from './signup';

const restricted = { mode: 'restricted' as const, allowedGithubUsers: ['octocat'] };
const candidate = { githubLogin: 'stranger', existingUsers: 3, hasPendingInvitation: false };

test('open mode admits everyone', () => {
	expect(canSignUp({ ...restricted, mode: 'open' }, candidate)).toBe(true);
});

test('restricted mode admits the first user', () => {
	expect(canSignUp(restricted, { ...candidate, existingUsers: 0 })).toBe(true);
});

test('restricted mode admits allowlisted logins case-insensitively', () => {
	expect(canSignUp(restricted, { ...candidate, githubLogin: 'OctoCat' })).toBe(true);
});

test('restricted mode admits invited users', () => {
	expect(canSignUp(restricted, { ...candidate, hasPendingInvitation: true })).toBe(true);
});

test('restricted mode rejects everyone else', () => {
	expect(canSignUp(restricted, candidate)).toBe(false);
	expect(canSignUp(restricted, { ...candidate, githubLogin: null })).toBe(false);
});
