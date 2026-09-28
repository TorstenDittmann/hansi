import { ANALYTICS_HOSTNAME, POSTHOG_KEY } from '@hans/analytics/constants';
import type { PostHog } from 'posthog-js';

/**
 * Starts PostHog in the browser on hansi.codes only. Cookieless: state lives in memory, so there
 * is nothing to consent to, and no session recordings. Pass the signed-in user's id so every page
 * load starts as that person instead of minting a fresh anonymous id to merge on identify().
 */
export async function startAnalytics(userId?: string): Promise<PostHog | null> {
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
		bootstrap: userId ? { distinctID: userId, isIdentifiedID: true } : undefined
	});
	return posthog;
}
