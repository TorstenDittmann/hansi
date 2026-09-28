import { expect, test } from 'bun:test';
import { analyticsCalls, analyticsEnabled, createAnalytics } from './index';

test('analytics only run on hansi.codes', () => {
	expect(analyticsEnabled('https://hansi.codes')).toBe(true);
	expect(analyticsEnabled('https://hansi.codes/')).toBe(true);
	expect(analyticsEnabled('https://hansi.example.com')).toBe(false);
	expect(analyticsEnabled('http://localhost:5173')).toBe(false);
	expect(analyticsEnabled('not a url')).toBe(false);
});

test('self-hosted instances get a client that sends nothing', async () => {
	const analytics = createAnalytics('https://review.example.com');
	analytics.capture({ distinctId: 'u1', event: 'signed up' });
	await analytics.shutdown();
});

test('a user event identifies that person before the event is captured', () => {
	expect(
		analyticsCalls({
			distinctId: 'user-1',
			event: 'signed up',
			person: { name: 'Ada', email: 'ada@hansi.codes', githubLogin: 'ada' }
		})
	).toEqual({
		identify: {
			distinctId: 'user-1',
			properties: { name: 'Ada', email: 'ada@hansi.codes', github_login: 'ada' }
		},
		capture: { distinctId: 'user-1', event: 'signed up', properties: undefined }
	});
});

test('an organization event does not create a person', () => {
	expect(
		analyticsCalls({
			distinctId: 'organization:org-1',
			event: 'review completed',
			organizationId: 'org-1',
			properties: { trigger: 'pull_request' }
		})
	).toEqual({
		identify: undefined,
		capture: {
			distinctId: 'organization:org-1',
			event: 'review completed',
			properties: { trigger: 'pull_request', $process_person_profile: false },
			groups: { organization: 'org-1' }
		}
	});
});
