import { ANALYTICS_HOSTNAME } from '@hans/analytics/constants';

/**
 * Canonical origin of the hosted product. Matches production `APP_URL` and the hostname analytics
 * already treat as hansi.codes. Self-hosted instances share this code but are not the public site.
 */
export const SITE_ORIGIN = `https://${ANALYTICS_HOSTNAME}`;
export const SITE_NAME = 'Hansi';

/** Default document / Open Graph title. Pages override by returning `title` from `load`. */
export const DEFAULT_TITLE = 'Hansi: AI code review that catches real bugs';

/** Default meta / Open Graph description. Pages override by returning `description` from `load`. */
export const DEFAULT_DESCRIPTION =
	'AI code review for GitHub that runs on your own model key: OpenAI, Anthropic, Amazon Bedrock, OpenRouter, and more. It catches real bugs, approves the rest, and grades each pull request from S to F.';

export const OG_IMAGE_PATH = '/og.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Public HTML pages that search engines may index. Login, dashboard, setup, and API stay out. */
export const PUBLIC_PATHS = ['/'] as const;

const PRIVATE_PREFIXES = ['/app', '/login', '/setup', '/api'];

/** True for the marketing homepage (and any future public page that is not an app/auth route). */
export function isIndexablePath(pathname: string): boolean {
	const path = normalizePath(pathname);
	return !PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Absolute URL for a site path, using the hosted origin. Homepage has no trailing slash. */
export function absoluteUrl(pathname: string, origin = SITE_ORIGIN): string {
	const base = origin.replace(/\/+$/, '');
	const path = normalizePath(pathname);
	return path === '/' ? base : `${base}${path}`;
}

export function sitemapXml(paths: readonly string[] = PUBLIC_PATHS, origin = SITE_ORIGIN): string {
	const urls = paths
		.map((path) => `\t<url>\n\t\t<loc>${escapeXml(absoluteUrl(path, origin))}</loc>\n\t</url>`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function normalizePath(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
	return pathname || '/';
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}
