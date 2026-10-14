import { expect, test } from 'bun:test';
import { parseRepoConfig } from '@hans/config';
import {
	liftStaleBugHold,
	settlementStanding,
	shouldApproveAfterSettlement,
	standingAgrees
} from './settlement';

const config = parseRepoConfig(null).config;

test('standing pairs an approval with S or A and a change request with B or worse', () => {
	expect(standingAgrees('S', 'approve')).toBe(true);
	expect(standingAgrees('A', 'approve')).toBe(true);
	expect(standingAgrees('B', 'approve')).toBe(false);
	expect(standingAgrees('S', 'request_changes')).toBe(false);
	expect(standingAgrees('A', 'request_changes')).toBe(false);
	expect(standingAgrees('B', 'request_changes')).toBe(true);
	expect(standingAgrees('D', 'request_changes')).toBe(true);
	expect(standingAgrees('S', 'comment')).toBe(true);
	expect(standingAgrees('B', 'comment')).toBe(true);
});

test('an approval is submitted once, and never for a moved head', () => {
	expect(
		shouldApproveAfterSettlement({
			verdict: 'approve',
			lastDecisiveVerdict: 'request_changes',
			headMoved: false
		})
	).toBe(true);
	expect(
		shouldApproveAfterSettlement({
			verdict: 'approve',
			lastDecisiveVerdict: null,
			headMoved: false
		})
	).toBe(true);
	expect(
		shouldApproveAfterSettlement({
			verdict: 'approve',
			lastDecisiveVerdict: 'approve',
			headMoved: false
		})
	).toBe(false);
	expect(
		shouldApproveAfterSettlement({
			verdict: 'approve',
			lastDecisiveVerdict: 'request_changes',
			headMoved: true
		})
	).toBe(false);
	expect(
		shouldApproveAfterSettlement({
			verdict: 'comment',
			lastDecisiveVerdict: null,
			headMoved: false
		})
	).toBe(false);
});

test('settlement of the last blocking finding approves and agrees with Tier S', () => {
	const standing = settlementStanding({
		summary: 'The previously reported cron finding remains open.',
		latestReviewId: 'review-1',
		config,
		approvalWithheld:
			'Not approving while a bug finding is open: Keep legacy cron schedules runnable',
		headMoved: false,
		findings: [
			{
				reviewId: 'review-1',
				severity: 'major',
				category: 'bug',
				title: 'Keep legacy cron schedules runnable',
				body: 'A null interval stops future runs.',
				status: 'dismissed'
			}
		]
	});
	expect(standing.tier).toBe('S');
	expect(standing.verdict).toBe('approve');
	expect(standing.approvalWithheld).toBeNull();
	expect(standing.summary).not.toContain('remains open');
	expect(standingAgrees(standing.tier, standing.verdict)).toBe(true);
});

test('Tier S with nothing open drops the bug note and approves', () => {
	const lifted = liftStaleBugHold({
		tier: 'S',
		verdict: 'comment',
		approvalWithheld:
			'Not approving while a bug finding is open: Publish revocation before fallible cleanup',
		openCount: 0,
		approve: true,
		headMoved: false
	});
	expect(lifted).toEqual({ verdict: 'approve', approvalWithheld: null });

	const standing = settlementStanding({
		summary: 'Publishes revocation before cleanup.',
		latestReviewId: 'review-1',
		config,
		approvalWithheld:
			'Not approving while a bug finding is open: Publish revocation before fallible cleanup',
		headMoved: false,
		findings: [
			{
				reviewId: 'review-1',
				severity: 'minor',
				category: 'bug',
				title: 'Publish revocation before fallible cleanup',
				body: 'Cleanup can fail after the token is still valid.',
				status: 'resolved'
			}
		]
	});
	expect(standing.tier).toBe('S');
	expect(standing.verdict).toBe('approve');
	expect(standing.approvalWithheld).toBeNull();
	expect(standingAgrees(standing.tier, standing.verdict)).toBe(true);
});

test('a finding left for a maintainer does not hold the tier or the verdict', () => {
	const standing = settlementStanding({
		summary: 'Bounds MQTT replay.',
		latestReviewId: 'review-2',
		config,
		approvalWithheld: 'Not approving while a bug finding is open: Treat unbound cursors as stale',
		headMoved: false,
		findings: [
			{
				reviewId: 'review-1',
				severity: 'minor',
				category: 'bug',
				title: 'Treat unbound cursors as stale',
				body: 'Old cursors replay on reconnect.',
				status: 'deferred'
			}
		]
	});
	expect(standing.tier).toBe('S');
	expect(standing.verdict).toBe('approve');
	expect(standing.approvalWithheld).toBeNull();
	expect(standingAgrees(standing.tier, standing.verdict)).toBe(true);
});

test('a major finding that is still posted keeps the change request', () => {
	const standing = settlementStanding({
		summary: 'Needs a fix.',
		latestReviewId: 'review-1',
		config,
		approvalWithheld: null,
		headMoved: false,
		findings: [
			{
				reviewId: 'review-1',
				severity: 'major',
				category: 'bug',
				title: 'Null interval drops the cron',
				body: 'Existing schedules stop.',
				status: 'posted'
			}
		]
	});
	expect(standing.tier).toBe('B');
	expect(standing.verdict).toBe('request_changes');
	expect(standingAgrees(standing.tier, standing.verdict)).toBe(true);
});
