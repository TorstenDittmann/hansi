// Shared with the browser, so no server-only imports here.

/** PostHog project for hansi.codes. Project keys are public; they only allow sending events. */
export const POSTHOG_KEY = 'phc_C6AJeok96GoAJnQyoMDbaCveQfFtEF4BZqajbKANbFMZ';
export const POSTHOG_HOST = 'https://eu.i.posthog.com';
/** Analytics run only on the hosted service, never on self-hosted instances or in development. */
export const ANALYTICS_HOSTNAME = 'hansi.codes';

/** Whether an instance at `appUrl` (its public URL) sends analytics. */
export function analyticsEnabled(appUrl: string): boolean {
	return URL.canParse(appUrl) && new URL(appUrl).hostname === ANALYTICS_HOSTNAME;
}
