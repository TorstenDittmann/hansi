import { createAnalytics, type Analytics } from '@hans/analytics';
import { getContext } from './context';

let analytics: Analytics | undefined;

/** Sends a product event to PostHog. Does nothing unless this instance is hansi.codes. */
export async function track(event: Parameters<Analytics['capture']>[0]) {
	if (!analytics) analytics = createAnalytics((await getContext()).env.APP_URL);
	analytics.capture(event);
}
