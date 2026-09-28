import { PostHog } from 'posthog-node';
import { analyticsEnabled, POSTHOG_HOST, POSTHOG_KEY } from './constants';

export * from './constants';

/**
 * Product analytics on the server, sent to PostHog. Events never carry code or repository names,
 * and identify people by their Hansi user id; the browser attaches name and email to that id.
 */
export interface Analytics {
	capture(event: {
		/** A user id, or `organization:<id>` for events no person triggered (e.g. a review). */
		distinctId: string;
		event: string;
		organizationId?: string;
		properties?: Record<string, unknown>;
	}): void;
	/** Sends queued events; call before the process exits. */
	shutdown(): Promise<void>;
}

export function createAnalytics(appUrl: string): Analytics {
	if (!analyticsEnabled(appUrl)) return { capture() {}, shutdown: async () => {} };

	// Traffic is low, so each event is sent right away instead of batched.
	const client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 });
	return {
		capture({ distinctId, event, organizationId, properties }) {
			client.capture({
				distinctId,
				event,
				properties,
				...(organizationId ? { groups: { organization: organizationId } } : {})
			});
		},
		shutdown: () => client.shutdown()
	};
}
