/** Path segments under `/app` that are not an organization slug. */
const RESERVED = new Set(['account', 'organizations']);

/** Overview for an organization. */
export function organizationHome(slug: string) {
	return `/app/${encodeURIComponent(slug)}`;
}

/**
 * Organization slug from an app path, when the first segment is one.
 * Account and organization admin are not slugs.
 */
export function organizationSlugFromPath(pathname: string): string | undefined {
	const raw = pathname.match(/^\/app\/([^/]+)/)?.[1];
	if (raw === undefined) return undefined;
	let segment = raw;
	try {
		segment = decodeURIComponent(segment);
	} catch {
		// Keep the raw segment when it is not valid percent-encoding.
	}
	if (RESERVED.has(segment)) return undefined;
	return segment;
}
