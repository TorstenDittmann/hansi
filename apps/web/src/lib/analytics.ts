import { ANALYTICS_HOSTNAME, POSTHOG_KEY } from '@hans/analytics/constants';
import type { PostHog } from 'posthog-js';

export interface AnalyticsUser {
	id: string;
	name: string;
	email: string;
	login?: string | null;
}

/**
 * Starts PostHog in the browser on hansi.codes only. Cookieless: state lives in memory, so there
 * is nothing to consent to, and no session recordings. Pass the signed-in user so the first events
 * use their id, instead of a fresh anonymous id that identify() would merge on every page load.
 */
export async function startAnalytics(user?: AnalyticsUser | null): Promise<PostHog | null> {
	if (location.hostname !== ANALYTICS_HOSTNAME) return null;
	const { default: posthog } = await import('posthog-js');
	posthog.init(POSTHOG_KEY, {
		// Proxied to PostHog by hooks.server.ts.
		api_host: '/ink',
		ui_host: 'https://eu.posthog.com',
		persistence: 'memory',
		person_profiles: 'identified_only',
		capture_pageview: false,
		capture_pageleave: true,
		disable_session_recording: true,
		// isIdentifiedID keeps this id from being merged with a new anonymous id. It does not
		// create a person profile; identifyAnalyticsUser sends the $identify that does.
		bootstrap: user ? { distinctID: user.id, isIdentifiedID: true } : undefined
	});
	if (user) identifyAnalyticsUser(posthog, user);
	return posthog;
}

/** One `$identify` per id and property set for this page. Memory persistence drops it on reload. */
let identified: string | undefined;

/**
 * Creates the PostHog person for this user. When the distinct id is already theirs, send
 * `$identify` directly: `posthog.identify()` would only `$set` properties, and `$set` does not
 * create a person profile. Omitting `$anon_distinct_id` keeps each page load from merging a new
 * anonymous id onto that person. A different current id (signed in after an anonymous session)
 * goes through `identify()`, which merges that one anonymous id.
 */
export function identifyAnalyticsUser(posthog: PostHog, user: AnalyticsUser) {
	const properties = {
		name: user.name,
		email: user.email,
		...(user.login ? { github_login: user.login } : {})
	};
	const key = `${user.id}:${JSON.stringify(properties)}`;
	if (identified === key) return;
	identified = key;
	if (posthog.get_distinct_id() === user.id) {
		posthog.capture('$identify', {}, { $set: properties });
	} else {
		posthog.identify(user.id, properties);
	}
}

/** Forgets the signed-in person. Call when they sign out. */
export function resetAnalyticsIdentity(posthog: PostHog) {
	identified = undefined;
	posthog.reset();
}
