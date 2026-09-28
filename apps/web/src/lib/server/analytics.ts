import { createAnalytics, type Analytics, type AnalyticsPerson } from '@hans/analytics';
import { getContext } from './context';

let analytics: Analytics | undefined;

/** Sends a product event to PostHog. Does nothing unless this instance is hansi.codes. */
export async function track(event: Parameters<Analytics['capture']>[0]) {
	if (!analytics) analytics = createAnalytics((await getContext()).env.APP_URL);
	analytics.capture(event);
}

/** Person properties PostHog should show for this user. */
export function analyticsPerson(user: {
	name: string;
	email: string;
	githubLogin?: string | null;
}): AnalyticsPerson {
	return { name: user.name, email: user.email, githubLogin: user.githubLogin ?? null };
}
