import { expect, test } from 'bun:test';
import type { PostHog } from 'posthog-js';
import { identifyAnalyticsUser, resetAnalyticsIdentity } from './analytics';

function client(distinctId: string) {
	const calls: { event: string; properties?: unknown; options?: unknown; identify?: unknown }[] =
		[];
	const posthog = {
		get_distinct_id: () => distinctId,
		capture(event: string, properties?: unknown, options?: unknown) {
			calls.push({ event, properties, options });
		},
		identify(id: string, properties?: unknown) {
			calls.push({ event: 'identify', identify: id, properties });
		},
		reset() {
			calls.push({ event: 'reset' });
		}
	};
	return { calls, posthog: posthog as unknown as PostHog };
}

const ada = { id: 'user-1', name: 'Ada', email: 'ada@hansi.codes', login: 'ada' };

test('an already-current user id is identified without merging an anonymous id', () => {
	const { calls, posthog } = client('user-1');
	resetAnalyticsIdentity(posthog);
	calls.length = 0;
	identifyAnalyticsUser(posthog, ada);
	identifyAnalyticsUser(posthog, ada);
	expect(calls).toEqual([
		{
			event: '$identify',
			properties: {},
			options: { $set: { name: 'Ada', email: 'ada@hansi.codes', github_login: 'ada' } }
		}
	]);
});

test('signing in merges the anonymous id, and signing out allows the next person', () => {
	const { calls, posthog } = client('anon');
	resetAnalyticsIdentity(posthog);
	calls.length = 0;
	identifyAnalyticsUser(posthog, ada);
	resetAnalyticsIdentity(posthog);
	identifyAnalyticsUser(posthog, { ...ada, id: 'user-2', email: 'grace@hansi.codes' });
	expect(calls.map((call) => call.event)).toEqual(['identify', 'reset', 'identify']);
	expect(calls[0]).toMatchObject({ identify: 'user-1' });
	expect(calls[2]).toMatchObject({ identify: 'user-2' });
});
