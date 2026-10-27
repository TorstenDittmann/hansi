import type { EvalCase } from '../types';

/**
 * A pull request across several independent areas, the kind a reviewer can split between
 * subagents: one bug per area, one area clean, and a caller in an unchanged file left behind.
 */

const invoiceBefore = `export interface Line {
	description: string;
	unitCents: number;
	quantity: number;
}

export function subtotal(lines: Line[]): number {
	return lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
}

export function total(lines: Line[], taxRate: number): number {
	const net = subtotal(lines);
	return Math.round(net * (1 + taxRate));
}
`;

const invoiceAfter = `export interface Line {
	description: string;
	unitCents: number;
	quantity: number;
}

export function subtotal(lines: Line[]): number {
	return lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
}

/**
 * Total in cents after a percentage discount and tax.
 * @param discountPercent 0 to 100, e.g. 15 for 15% off.
 */
export function total(lines: Line[], taxRate: number, discountPercent = 0): number {
	const net = subtotal(lines) - discountPercent;
	return Math.round(net * (1 + taxRate));
}
`;

const sessionBefore = `export interface Session {
	id: string;
	userId: string;
	expiresAt: number;
}

const sessions = new Map<string, Session>();

export function createSession(userId: string, ttlMs: number): Session {
	const session = { id: crypto.randomUUID(), userId, expiresAt: Date.now() + ttlMs };
	sessions.set(session.id, session);
	return session;
}

export function getSession(id: string): Session | null {
	return sessions.get(id) ?? null;
}
`;

const sessionAfter = `export interface Session {
	id: string;
	userId: string;
	expiresAt: number;
}

const sessions = new Map<string, Session>();

export function createSession(userId: string, ttlMs: number): Session {
	const session = { id: crypto.randomUUID(), userId, expiresAt: Date.now() + ttlMs };
	sessions.set(session.id, session);
	return session;
}

/** The session, or null when it does not exist or has expired. Expired sessions are removed. */
export function getSession(id: string): Session | null {
	const session = sessions.get(id);
	if (!session) return null;
	if (session.expiresAt > Date.now()) {
		sessions.delete(id);
		return null;
	}
	return session;
}
`;

const queryBefore = `export function buildSearch(term: string): { sql: string; params: string[] } {
	return { sql: 'SELECT id, title FROM posts WHERE title LIKE ?', params: [\`%\${term}%\`] };
}
`;

const queryAfter = `/** Escapes LIKE wildcards so a search for "50%" matches the literal text. */
export function escapeLike(term: string): string {
	return term.replace(/[\\\\%_]/g, (char) => \`\\\\\${char}\`);
}

export function buildSearch(term: string): { sql: string; params: string[] } {
	return {
		sql: "SELECT id, title FROM posts WHERE title LIKE ? ESCAPE '\\\\'",
		params: [\`%\${escapeLike(term)}%\`]
	};
}
`;

const digestBefore = `export interface DigestItem {
	title: string;
	at: number;
}

export function buildDigest(userId: string, since: number, items: DigestItem[]): string {
	const recent = items.filter((item) => item.at >= since);
	if (recent.length === 0) return '';
	return [\`Digest for \${userId}\`, ...recent.map((item) => \`- \${item.title}\`)].join('\\n');
}
`;

const digestAfter = `export interface DigestItem {
	title: string;
	at: number;
}

export interface DigestUser {
	id: string;
	name: string;
}

export function buildDigest(user: DigestUser, since: number, items: DigestItem[]): string {
	const recent = items.filter((item) => item.at >= since);
	if (recent.length === 0) return '';
	return [\`Digest for \${user.name}\`, ...recent.map((item) => \`- \${item.title}\`)].join('\\n');
}
`;

const dailyJob = `import { buildDigest, type DigestItem } from '../notifications/digest';

export function runDailyDigest(userIds: string[], items: DigestItem[], now: number): string[] {
	const since = now - 24 * 60 * 60 * 1000;
	return userIds.map((id) => buildDigest(id, since, items)).filter(Boolean);
}
`;

const lineOf = (content: string, needle: string): [number, number] => {
	const index = content.indexOf(needle);
	if (index === -1) throw new Error(`"${needle}" not found`);
	const line = content.slice(0, index).split('\n').length;
	return [line, line];
};

export const multiAreaCases: EvalCase[] = [
	{
		name: 'multi-area-release',
		description:
			'Billing, auth, search, and notifications change together: a discount subtracted as cents, an inverted expiry check, a clean LIKE escape, and a caller in an unchanged file left behind.',
		base: {
			'src/billing/invoice.ts': invoiceBefore,
			'src/auth/session.ts': sessionBefore,
			'src/search/query.ts': queryBefore,
			'src/notifications/digest.ts': digestBefore,
			'src/jobs/daily.ts': dailyJob
		},
		head: {
			'src/billing/invoice.ts': invoiceAfter,
			'src/auth/session.ts': sessionAfter,
			'src/search/query.ts': queryAfter,
			'src/notifications/digest.ts': digestAfter
		},
		pullRequest: {
			title: 'Release prep: discounts, session expiry, literal search, named digests',
			body: 'Adds percentage discounts to invoices, expires sessions on read, escapes LIKE wildcards in search, and greets users by name in digests.'
		},
		expected: [
			{
				path: 'src/billing/invoice.ts',
				lines: lineOf(invoiceAfter, 'subtotal(lines) - discountPercent'),
				description:
					'discountPercent is subtracted as cents instead of applied as a percentage: 15% off a $100 invoice takes off 15 cents.'
			},
			{
				path: 'src/auth/session.ts',
				lines: lineOf(sessionAfter, 'session.expiresAt > Date.now()'),
				description:
					'The expiry check is inverted: live sessions are deleted and expired ones are returned.'
			},
			{
				path: 'src/notifications/digest.ts',
				lines: lineOf(digestAfter, 'export function buildDigest(user: DigestUser'),
				description:
					'src/jobs/daily.ts still passes a user id string, so user.name is undefined in every digest.'
			}
		]
	}
];
