import { ANALYTICS_HOSTNAME, POSTHOG_HOST, POSTHOG_KEY } from '@hans/analytics/constants';
import type { PostHog } from 'posthog-js';

/**
 * Starts PostHog in the browser on hansi.codes only. Cookieless: state lives in memory, so there
 * is nothing to consent to, and no session recordings.
 */
export async function startAnalytics(): Promise<PostHog | null> {
	if (location.hostname !== ANALYTICS_HOSTNAME) return null;
	const { default: posthog } = await import('posthog-js');
	posthog.init(POSTHOG_KEY, {
		api_host: POSTHOG_HOST,
		persistence: 'memory',
		person_profiles: 'identified_only',
		capture_pageview: false,
		capture_pageleave: true,
		disable_session_recording: true
	});
	return posthog;
}
