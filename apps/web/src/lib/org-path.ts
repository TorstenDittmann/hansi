/** Path segments under `/app` that are not an organization slug. */
const RESERVED = new Set(['account', 'organizations']);

/** Sections that used to live at `/app/<section>` before the slug was added. */
const LEGACY_SECTIONS = ['reviews', 'repositories', 'settings', 'integration'] as const;

/**
 * Organization slug from an app path, when the first segment is one.
 * Account, organization admin, and the old unscoped sections are not slugs.
 */
export function organizationSlugFromPath(pathname: string): string | undefined {
	const match = pathname.match(/^\/app\/([^/]+)/);
	if (!match) return undefined;
	let segment = match[1]!;
	try {
		segment = decodeURIComponent(segment);
	} catch {
		// Keep the raw segment when it is not valid percent-encoding.
	}
	if (RESERVED.has(segment) || (LEGACY_SECTIONS as readonly string[]).includes(segment)) {
		return undefined;
	}
	return segment;
}

/**
 * Where an old `/app` or `/app/<section>` URL should go once the slug is known.
 * Returns null when the path already includes an organization, or is not an app page.
 */
export function legacyAppDestination(
	pathname: string,
	search: string,
	slug: string
): string | null {
	const encoded = encodeURIComponent(slug);
	if (pathname === '/app' || pathname === '/app/') return `/app/${encoded}${search}`;
	const match = pathname.match(/^\/app\/(reviews|repositories|settings|integration)(\/.*)?$/);
	if (!match) return null;
	return `/app/${encoded}/${match[1]}${match[2] ?? ''}${search}`;
}
