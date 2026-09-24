import { expect, test } from 'bun:test';
import { absoluteUrl, isIndexablePath, PUBLIC_PATHS, SITE_ORIGIN, sitemapXml } from './seo';

test('the hosted origin is hansi.codes', () => {
	expect(SITE_ORIGIN).toBe('https://hansi.codes');
});

test('absolute URLs drop a trailing slash except on the origin itself', () => {
	expect(absoluteUrl('/')).toBe('https://hansi.codes');
	expect(absoluteUrl('/faq/')).toBe('https://hansi.codes/faq');
});

test('login, dashboard, setup, and API routes are not indexable', () => {
	expect(isIndexablePath('/')).toBe(true);
	expect(isIndexablePath('/login')).toBe(false);
	expect(isIndexablePath('/login/')).toBe(false);
	expect(isIndexablePath('/app')).toBe(false);
	expect(isIndexablePath('/app/reviews/1')).toBe(false);
	expect(isIndexablePath('/setup')).toBe(false);
	expect(isIndexablePath('/setup/github/callback')).toBe(false);
	expect(isIndexablePath('/api/auth/ok')).toBe(false);
});

test('the sitemap lists only public pages at hansi.codes', () => {
	expect([...PUBLIC_PATHS]).toEqual(['/']);
	const xml = sitemapXml();
	expect(xml).toContain('<loc>https://hansi.codes</loc>');
	expect(xml).not.toContain('/login');
	expect(xml).not.toContain('/app');
	expect(xml).not.toContain('/api');
	expect(xml).not.toContain('/setup');
});
