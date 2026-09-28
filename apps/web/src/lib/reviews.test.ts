import { expect, test } from 'bun:test';
import {
	clampReviewPage,
	likeContains,
	normalizeReviewQuery,
	parseReviewFilters,
	reviewPageCount,
	reviewSearch
} from './reviews';

const statuses = ['queued', 'running', 'completed', 'failed', 'skipped', 'superseded'];

test('normalizes search text and pull request numbers', () => {
	expect(normalizeReviewQuery(null)).toBe('');
	expect(normalizeReviewQuery('  acme/web  ')).toBe('acme/web');
	expect(normalizeReviewQuery('#12')).toBe('12');
	expect(normalizeReviewQuery(' #12 ')).toBe('12');
});

test('escapes LIKE wildcards so search text stays literal', () => {
	expect(likeContains('web')).toBe('%web%');
	expect(likeContains('100%')).toBe('%100\\%%');
	expect(likeContains('a_b')).toBe('%a\\_b%');
	expect(likeContains('a\\b')).toBe('%a\\\\b%');
});

test('clamps the page to the reviews that exist', () => {
	expect(reviewPageCount(0)).toBe(1);
	expect(reviewPageCount(25)).toBe(1);
	expect(reviewPageCount(26)).toBe(2);
	expect(clampReviewPage(1, 0)).toBe(1);
	expect(clampReviewPage(9, 10)).toBe(1);
	expect(clampReviewPage(2, 30)).toBe(2);
	expect(clampReviewPage(Number.NaN, 30)).toBe(1);
	expect(clampReviewPage(1.5, 100)).toBe(1);
});

test('builds a canonical query string and drops empty filters', () => {
	expect(reviewSearch({})).toBe('');
	expect(reviewSearch({ query: ' #12 ', page: 1 })).toBe('?q=12');
	const params = new URLSearchParams(
		reviewSearch({ query: 'web', repository: 'acme/web', status: 'failed', page: 2 }).slice(1)
	);
	expect(params.get('q')).toBe('web');
	expect(params.get('repo')).toBe('acme/web');
	expect(params.get('status')).toBe('failed');
	expect(params.get('page')).toBe('2');
});

test('flags raw filters that are not canonical', () => {
	const clean = parseReviewFilters(
		{ query: 'web', repository: 'acme/web', status: 'completed', page: '2' },
		statuses
	);
	expect(clean).toMatchObject({
		query: 'web',
		repository: 'acme/web',
		status: 'completed',
		requested: 2,
		filtersDirty: false
	});

	const dirty = parseReviewFilters(
		{ query: ' #12 ', repository: ' acme/web ', status: 'nope', page: null },
		statuses
	);
	expect(dirty).toMatchObject({
		query: '12',
		repository: 'acme/web',
		status: '',
		requested: 1,
		filtersDirty: true
	});
});
