// Shared with the browser, so no server-only imports here.

/** PostHog project for hansi.codes. Project keys are public; they only allow sending events. */
export const POSTHOG_KEY = 'phc_C6AJeok96GoAJnQyoMDbaCveQfFtEF4BZqajbKANbFMZ';
/** EU Cloud ingestion. The Node SDK calls this directly; browsers use {@link POSTHOG_PROXY_PATH}. */
export const POSTHOG_HOST = 'https://eu.i.posthog.com';
/** EU Cloud asset host for `/static/` and `/array/` SDK files. */
export const POSTHOG_ASSETS_HOST = 'https://eu-assets.i.posthog.com';
/** PostHog app origin. Required so the toolbar and other UI links leave the first-party proxy. */
export const POSTHOG_UI_HOST = 'https://eu.posthog.com';
/**
 * First-party path the browser SDK posts to. SvelteKit forwards it to PostHog.
 * Not an obvious analytics name, so domain blockers miss it.
 */
export const POSTHOG_PROXY_PATH = '/ink';
/** Analytics run only on the hosted service, never on self-hosted instances or in development. */
export const ANALYTICS_HOSTNAME = 'hansi.codes';

/** Whether an instance at `appUrl` (its public URL) sends analytics. */
export function analyticsEnabled(appUrl: string): boolean {
	return URL.canParse(appUrl) && new URL(appUrl).hostname === ANALYTICS_HOSTNAME;
}
