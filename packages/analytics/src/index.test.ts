import { expect, test } from 'bun:test';
import { analyticsEnabled, createAnalytics } from './index';

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
