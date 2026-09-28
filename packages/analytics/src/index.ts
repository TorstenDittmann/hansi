import { PostHog } from 'posthog-node';
import { analyticsEnabled, POSTHOG_HOST, POSTHOG_KEY } from './constants';

export * from './constants';

/** Name and email for the person who triggered an event. */
export interface AnalyticsPerson {
	name?: string | null;
	email?: string | null;
	githubLogin?: string | null;
}

/**
 * Product analytics on the server, sent to PostHog. Events never carry code or repository names.
 * A user's id is sent with `$identify`, which is what creates their person profile; name and email
 * are attached when we have them. `organization:<id>` is not a person, so those events do not
 * create one.
 */
export interface Analytics {
	capture(event: {
		/** A user id, or `organization:<id>` for events no person triggered (e.g. a review). */
		distinctId: string;
		event: string;
		organizationId?: string;
		properties?: Record<string, unknown>;
		person?: AnalyticsPerson;
	}): void;
	/** Sends queued events; call before the process exits. */
	shutdown(): Promise<void>;
}

/** PostHog calls for one product event. `$identify` is what creates a person profile. */
export function analyticsCalls(event: Parameters<Analytics['capture']>[0]) {
	const organization = event.distinctId.startsWith('organization:');
	const properties = organization
		? { ...event.properties, $process_person_profile: false }
		: event.properties;
	return {
		// Distinct ids show up on events either way. Only $identify creates the person the
		// Persons tab lists. Organization ids are not people.
		identify: organization
			? undefined
			: { distinctId: event.distinctId, properties: personProperties(event.person) },
		capture: {
			distinctId: event.distinctId,
			event: event.event,
			properties,
			...(event.organizationId ? { groups: { organization: event.organizationId } } : {})
		}
	};
}

export function createAnalytics(appUrl: string): Analytics {
	if (!analyticsEnabled(appUrl)) return { capture() {}, shutdown: async () => {} };

	// Traffic is low, so each event is sent right away instead of batched.
	const client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 1, flushInterval: 0 });
	return {
		capture(event) {
			const calls = analyticsCalls(event);
			if (calls.identify) client.identify(calls.identify);
			client.capture(calls.capture);
		},
		shutdown: () => client.shutdown()
	};
}

function personProperties(person?: AnalyticsPerson): Record<string, string> {
	if (!person) return {};
	return {
		...(person.name ? { name: person.name } : {}),
		...(person.email ? { email: person.email } : {}),
		...(person.githubLogin ? { github_login: person.githubLogin } : {})
	};
}
