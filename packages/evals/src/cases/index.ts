import type { EvalCase } from '../types';

/** 1-based line range of the first line containing `needle`, so expectations track the code. */
function lineOf(content: string, needle: string): [number, number] {
	return lineOfNth(content, needle, 1);
}

/** 1-based line of the nth occurrence of `needle` (1-based). */
function lineOfNth(content: string, needle: string, occurrence: number): [number, number] {
	let from = 0;
	for (let n = 1; n <= occurrence; n++) {
		const index = content.indexOf(needle, from);
		if (index === -1) throw new Error(`"${needle}" occurrence ${occurrence} not found`);
		if (n === occurrence) {
			const line = content.slice(0, index).split('\n').length;
			return [line, line];
		}
		from = index + needle.length;
	}
	throw new Error(`"${needle}" occurrence ${occurrence} not found`);
}

const paginate = `/** Pages are 1-based: page 1 is the first page. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
	const start = page * pageSize;
	return items.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize: number): number {
	return Math.floor(total / pageSize);
}
`;

const orders = `import { db } from './db';
import { sendReceipt } from './mail';

export async function placeOrder(userId: string, items: string[]) {
	const order = await db.orders.create({ userId, items });
	await db.inventory.reserve(items);
	await sendReceipt(userId, order.id);
	return order;
}

export async function cancelOrder(orderId: string) {
	const order = db.orders.find(orderId);
	if (order.status === 'shipped') throw new Error('Already shipped');
	await db.orders.update(orderId, { status: 'cancelled' });
}
`;

const users = `import sqlite3


def get_user(conn: sqlite3.Connection, user_id: int):
    cur = conn.execute("SELECT id, name, email FROM users WHERE id = ?", (user_id,))
    return cur.fetchone()


def search_users(conn: sqlite3.Connection, name: str):
    query = f"SELECT id, name, email FROM users WHERE name LIKE '%{name}%'"
    return conn.execute(query).fetchall()
`;

const countLines = `package files

import (
	"bufio"
	"os"
)

// CountLines returns the total number of lines across all files.
func CountLines(paths []string) (int, error) {
	total := 0
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			return 0, err
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			total++
		}
	}
	return total, nil
}
`;

const auth = `export interface User {
	id: string;
	roles: string[];
}

export function isAdmin(user: User): boolean {
	return user.roles.includes('admin');
}

export function canDelete(user: User, ownerId: string): boolean {
	if (!isAdmin(user)) return true;
	return user.id === ownerId;
}
`;

const priceBefore = `export function total(p: number[], t: number) {
	let s = 0;
	for (const x of p) s += x;
	return s * (1 + t);
}
`;

const priceAfter = `export function total(prices: number[], taxRate: number) {
	let subtotal = 0;
	for (const price of prices) subtotal += price;
	return subtotal * (1 + taxRate);
}
`;

const moneyAfter = `/** Formats an amount in dollars, e.g. 19.99 → "$19.99". */
export function formatPrice(dollars: number, currency = '$'): string {
	return \`\${currency}\${dollars.toFixed(2)}\`;
}
`;

const fetchBefore = `export async function fetchJson(url: string, timeoutMs = 30_000, retries = 2): Promise<unknown> {
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
			return await response.json();
		} catch (error) {
			if (attempt >= retries) throw error;
		}
	}
}
`;

const fetchAfter = `export interface FetchOptions {
	timeoutMs?: number;
	retries?: number;
}

export async function fetchJson(url: string, options: FetchOptions = {}): Promise<unknown> {
	const { timeoutMs = 3_000, retries = 2 } = options;
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
			return await response.json();
		} catch (error) {
			if (attempt >= retries) throw error;
		}
	}
}
`;

const detector = `export type Adapter = 'static' | 'ssr';

/**
 * A prerender block narrowed with routes or filter still needs the server adapter.
 * crawlLinks alone prerenders the whole site, so that stays static.
 */
export function adapter(source: string): Adapter {
	const body = prerenderBody(source);
	if (body === null) return 'static';
	if (narrowed(body)) return 'ssr';
	return 'static';
}

/** The object literal after prerender:, or null when the app does not prerender. */
function prerenderBody(source: string): string | null {
	const block = source.match(/prerender\\s*:\\s*\\{([^}]*)\\}/);
	return block ? (block[1] ?? null) : null;
}

function narrowed(body: string): boolean {
	return /\\broutes\\s*:/.test(body) || /\\bfilter\\s*:/.test(body);
}
`;

const storageBase = `/** Content-Type may include parameters, for example application/xml; charset=UTF-8. */
export function mediaType(header: string): string {
	const [type] = header.split(';');
	return (type ?? '').trim().toLowerCase();
}

export function escapeXml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Deletes one object. Keys are text, so they are escaped before they enter the XML body. */
export function deleteObject(key: string): string {
	const body = \`<Object><Key>\${escapeXml(key)}</Key></Object>\`;
	return \`<?xml version="1.0"?><Delete>\${body}</Delete>\`;
}
`;

const storageHead = `${storageBase}
function parseXml(raw: string): { Error?: { Key: string; Message: string } } {
	if (!raw.includes('<Error>')) return {};
	return { Error: { Key: 'object', Message: 'AccessDenied' } };
}

/** Deletes every listed key in one request. */
export function deleteKeys(keys: string[]): string {
	const objects = keys.map((key) => \`<Object><Key>\${key}</Key></Object>\`).join('');
	return \`<?xml version="1.0"?><Delete>\${objects}</Delete>\`;
}

/**
 * True when a bulk-delete response names a key that was not deleted.
 * Callers pass the raw response body and the Content-Type header.
 */
export function deletionFailed(contentType: string, raw: string): boolean {
	const body = contentType === 'application/xml' ? parseXml(raw) : raw;
	if (typeof body !== 'object' || body === null) return false;
	return 'Error' in body;
}
`;

const onboardingBase = `export type StageStatus = 'pending' | 'skipped' | 'completed';

export interface Stage {
	id: string;
	status: StageStatus;
}

export interface Store {
	write(projectId: string, stages: Stage[]): Promise<void>;
}

/**
 * One project's onboarding stages.
 * skip and complete are separate requests and can run at the same time.
 */
export class Onboarding {
	stages: Stage[] = [];

	constructor(
		private readonly projectId: string,
		private readonly store: Store
	) {}

	async skip(id: string): Promise<void> {
		const next = this.stages.map((stage) => ({ ...stage }));
		const stage = next.find((item) => item.id === id);
		if (stage) stage.status = 'skipped';
		await this.save(next);
	}

	async complete(id: string): Promise<void> {
		const next = this.stages.map((stage) => ({ ...stage }));
		const stage = next.find((item) => item.id === id);
		if (stage && stage.status === 'pending') stage.status = 'completed';
		await this.save(next);
	}

	private async save(next: Stage[]): Promise<void> {
		await this.store.write(this.projectId, next);
		this.stages = next;
	}
}
`;

const onboardingHead = `export type StageStatus = 'pending' | 'skipped' | 'completed';

export interface Stage {
	id: string;
	status: StageStatus;
}

export interface Store {
	write(projectId: string, stages: Stage[]): Promise<void>;
}

/**
 * One project's onboarding stages.
 * skip and complete are separate requests and can run at the same time.
 */
export class Onboarding {
	stages: Stage[] = [];
	private gate: Promise<void> = Promise.resolve();

	constructor(
		private readonly projectId: string,
		private readonly store: Store
	) {}

	async skip(id: string): Promise<void> {
		const next = this.stages.map((stage) => ({ ...stage }));
		const stage = next.find((item) => item.id === id);
		if (stage && stage.status !== 'completed') stage.status = 'skipped';
		await this.save(next);
	}

	async complete(id: string): Promise<void> {
		const previous = this.gate;
		let done = () => undefined;
		this.gate = new Promise<void>((resolve) => {
			done = resolve;
		});
		await previous;
		try {
			const next = this.stages.map((stage) => ({ ...stage }));
			const stage = next.find((item) => item.id === id);
			if (stage && stage.status !== 'completed') stage.status = 'completed';
			await this.save(next);
		} finally {
			done();
		}
	}

	private async save(next: Stage[]): Promise<void> {
		await this.store.write(this.projectId, next);
		this.stages = next;
	}
}
`;

const avatarsBase = `/** Pulls {response.field} out of a JSON body. A missing field becomes an empty id. */
export function resourceId(template: string, body: unknown): string {
	return template.replace(/\\{response\\.(\\w+)\\}/g, (_match, key: string) => {
		if (!body || typeof body !== 'object' || !(key in body)) return '';
		return String((body as Record<string, unknown>)[key]);
	});
}

/** Drops the event when the label does not resolve to a resource id. */
export function record(template: string, body: unknown, events: string[]): void {
	const id = resourceId(template, body);
	if (!id) return;
	events.push(\`\${id} \${template}\`);
}

export function createAvatar(userId: string, events: string[]): { status: number } {
	const body = { userId };
	record('avatars.create {response.userId}', body, events);
	return { status: 201 };
}
`;

const avatarsHead = `${avatarsBase}
export function deleteAvatar(userId: string, events: string[]): { status: number } {
	record('avatars.delete {response.userId}', null, events);
	return { status: 204 };
}
`;

const avatarBytesBase = `export interface StoredAvatar {
	contentType: string;
	bytes: Uint8Array;
}

/** PNG bytes pass through. Anything else cannot be transcoded here and returns null. */
export function toPng(bytes: Uint8Array): Uint8Array | null {
	if (bytes.length >= 2 && bytes[0] === 0x89 && bytes[1] === 0x50) return bytes;
	return null;
}
`;

const avatarBytesHead = `${avatarBytesBase}
export function acceptAvatar(filename: string, bytes: Uint8Array): StoredAvatar {
	const dot = filename.lastIndexOf('.');
	const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
	if (ext !== '.png' && ext !== '.jpg' && ext !== '.webp') {
		throw new Error('Only PNG, JPEG, and WebP avatars are allowed');
	}
	const png = toPng(bytes);
	if (!png) return { contentType: 'image/png', bytes };
	return { contentType: 'image/png', bytes: png };
}
`;

const queueBase = `export const MAX_DELIVER = 5;

export function spareDelivery(maxDeliver: number): number {
	return maxDeliver + 1;
}
`;

const queueTest = `import { expect, test } from 'bun:test';
import { MAX_DELIVER, spareDelivery } from './queue';

test('spare delivery is one past the configured maximum', () => {
	expect(spareDelivery(MAX_DELIVER)).toBe(MAX_DELIVER + 1);
	expect(MAX_DELIVER).toBe(5);
});
`;

export const cases: EvalCase[] = [
	{
		name: 'ts-pagination-off-by-one',
		description: 'Documents 1-based pages but keeps 0-based math; page count rounds down.',
		base: {
			'src/paginate.ts': `export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
	const start = page * pageSize;
	return items.slice(start, start + pageSize);
}
`
		},
		head: { 'src/paginate.ts': paginate },
		pullRequest: { title: 'Switch pagination to 1-based pages and add pageCount' },
		expected: [
			{
				path: 'src/paginate.ts',
				lines: lineOf(paginate, 'const start = page * pageSize'),
				description:
					'With 1-based pages the offset must be (page - 1) * pageSize; page 1 skips the first page.'
			},
			{
				path: 'src/paginate.ts',
				lines: lineOf(paginate, 'Math.floor'),
				description: 'Math.floor drops the last partial page; use Math.ceil.'
			}
		]
	},
	{
		name: 'ts-missing-await',
		description: 'A missing await makes a status guard always pass.',
		base: {
			'src/db.ts': `type Order = { id: string; userId: string; items: string[]; status: string };

export const db = {
	orders: {
		create: async (data: { userId: string; items: string[] }): Promise<Order> => ({
			...data,
			id: crypto.randomUUID(),
			status: 'new'
		}),
		find: async (id: string): Promise<Order> => ({ id, userId: 'u', items: [], status: 'new' }),
		update: async (id: string, data: Partial<Order>) => ({ id, ...data })
	},
	inventory: { reserve: async (items: string[]) => items.length }
};
`,
			'src/mail.ts': `export async function sendReceipt(userId: string, orderId: string): Promise<void> {
	console.log('receipt', userId, orderId);
}
`,
			'src/orders.ts': `import { db } from './db';

export async function placeOrder(userId: string, items: string[]) {
	const order = await db.orders.create({ userId, items });
	return order;
}
`
		},
		head: { 'src/orders.ts': orders },
		pullRequest: { title: 'Reserve inventory, send receipts, allow cancelling orders' },
		expected: [
			{
				path: 'src/orders.ts',
				lines: lineOf(orders, 'const order = db.orders.find'),
				description:
					'find() is async; without await, order.status is undefined and shipped orders can be cancelled.'
			}
		]
	},
	{
		name: 'py-sql-injection',
		description: 'String-formatted SQL next to a correctly parameterized query.',
		base: {
			'app/users.py': users.slice(0, users.indexOf('\n\ndef search_users')) + '\n'
		},
		head: { 'app/users.py': users },
		pullRequest: { title: 'Add user search' },
		expected: [
			{
				path: 'app/users.py',
				lines: lineOf(users, 'query = f"SELECT'),
				description: 'User input is interpolated into SQL; use a parameter for the LIKE pattern.'
			}
		]
	},
	{
		name: 'go-defer-in-loop',
		description: 'defer inside a loop keeps every file open; scanner errors are ignored.',
		base: { 'go.mod': 'module example.com/files\n\ngo 1.23\n' },
		head: { 'internal/files/count.go': countLines },
		pullRequest: { title: 'Add CountLines helper' },
		expected: [
			{
				path: 'internal/files/count.go',
				lines: lineOf(countLines, 'defer f.Close()'),
				description: 'Deferred Close runs only when CountLines returns, so all files stay open.'
			},
			{
				path: 'internal/files/count.go',
				lines: [
					lineOf(countLines, 'for scanner.Scan()')[0],
					lineOf(countLines, 'return total, nil')[0]
				],
				description:
					'scanner.Err() is never checked, so read errors silently produce a wrong count.'
			}
		]
	},
	{
		name: 'ts-inverted-authorization',
		description: 'An inverted admin check lets every non-admin delete anything.',
		base: {
			'src/auth.ts': `export interface User {
	id: string;
	roles: string[];
}

export function canDelete(user: User, ownerId: string): boolean {
	return user.id === ownerId;
}
`
		},
		head: { 'src/auth.ts': auth },
		pullRequest: { title: 'Let admins delete any resource' },
		expected: [
			{
				path: 'src/auth.ts',
				lines: lineOf(auth, 'if (!isAdmin(user)) return true'),
				description:
					'The condition is inverted: non-admins get true, admins fall through to the owner check.'
			}
		]
	},
	{
		name: 'ts-caller-left-behind',
		description: 'formatPrice switches from cents to dollars; one caller still passes cents.',
		base: {
			'src/money.ts': `/** Formats an amount in cents, e.g. 1999 → "$19.99". */
export function formatPrice(cents: number): string {
	return \`$\${(cents / 100).toFixed(2)}\`;
}
`,
			'src/cart.ts': `import { formatPrice } from './money';

export interface Item {
	name: string;
	priceCents: number;
}

export function cartLine(item: Item): string {
	return \`\${item.name}: \${formatPrice(item.priceCents)}\`;
}
`,
			'src/invoice.ts': `import { formatPrice } from './money';

export function invoiceTotal(totalCents: number): string {
	return \`Total: \${formatPrice(totalCents)}\`;
}
`
		},
		head: {
			'src/money.ts': moneyAfter,
			'src/invoice.ts': `import { formatPrice } from './money';

export function invoiceTotal(totalCents: number): string {
	return \`Total: \${formatPrice(totalCents / 100)}\`;
}
`
		},
		pullRequest: { title: 'Let formatPrice take dollars and a currency symbol' },
		expected: [
			{
				path: 'src/money.ts',
				lines: [
					lineOf(moneyAfter, 'export function formatPrice')[0],
					lineOf(moneyAfter, 'return `${currency}')[0]
				],
				description:
					'cartLine in src/cart.ts still passes cents, so cart prices show 100 times too high.'
			}
		]
	},
	{
		name: 'ts-changed-default',
		description: 'A refactor to an options object silently cuts the default timeout to 3s.',
		base: {
			'src/http.ts': fetchBefore,
			'src/reports.ts': `import { fetchJson } from './http';

/** Monthly reports are generated on request and can take 20 seconds. */
export function monthlyReport(month: string) {
	return fetchJson(\`https://api.example.com/reports/\${month}\`);
}
`
		},
		head: { 'src/http.ts': fetchAfter },
		pullRequest: { title: 'Take fetchJson options as an object' },
		expected: [
			{
				path: 'src/http.ts',
				lines: lineOf(fetchAfter, 'const { timeoutMs = 3_000'),
				description:
					'The default timeout changed from 30s to 3s, so slow requests such as monthly reports now fail.'
			}
		]
	},
	{
		name: 'clean-rename',
		description: 'A pure rename. Any comment is noise.',
		base: { 'src/price.ts': priceBefore },
		head: { 'src/price.ts': priceAfter },
		pullRequest: { title: 'Use descriptive names in total()' },
		expected: []
	},
	{
		name: 'clean-tests',
		description: 'Adds straightforward tests. Any comment is noise.',
		base: { 'src/price.ts': priceAfter },
		head: {
			'src/price.test.ts': `import { expect, test } from 'bun:test';
import { total } from './price';

test('sums prices and applies tax', () => {
	expect(total([10, 20], 0.1)).toBeCloseTo(33);
});

test('an empty cart costs nothing', () => {
	expect(total([], 0.2)).toBe(0);
});
`
		},
		pullRequest: { title: 'Add tests for total()' },
		expected: []
	},
	{
		name: 'ts-adjacent-config-match',
		description:
			'A new prerender match handles routes: and filter:, and misses a nested object and a shorthand property.',
		base: {
			'src/detector.ts': `export type Adapter = 'static' | 'ssr';

/** TanStack Start ships a static adapter unless the app opts into a server. */
export function adapter(_source: string): Adapter {
	return 'static';
}
`
		},
		head: { 'src/detector.ts': detector },
		pullRequest: {
			title: 'Treat a narrowed TanStack Start prerender config as SSR',
			body: 'A prerender block that sets routes or filter only prerenders some paths, so the app still needs the server adapter. crawlLinks on its own stays static.'
		},
		expected: [
			{
				path: 'src/detector.ts',
				lines: lineOf(detector, 'prerender\\s*:\\s*\\{([^}]*)\\}'),
				description:
					"The capture stops at the first }, so prerender: { ...{ crawlLinks: true }, routes: ['/'] } is classified static."
			},
			{
				path: 'src/detector.ts',
				lines: lineOf(detector, 'return /\\broutes\\s*:/.test(body)'),
				description:
					'A shorthand property such as prerender: { routes, crawlLinks: true } has no routes: and stays static.'
			}
		]
	},
	{
		name: 'ts-bulk-delete-encoding',
		description:
			'Recursive bulk delete inserts raw keys into XML, and an error document with a charset is treated as success.',
		base: {
			'src/storage.ts': storageBase
		},
		head: { 'src/storage.ts': storageHead },
		pullRequest: {
			title: 'Bulk-delete listed keys and report per-key errors',
			body: 'Deleting a prefix now deletes every listed object, and a bulk-delete response that names a failed key is reported as a failure.'
		},
		expected: [
			{
				path: 'src/storage.ts',
				lines: lineOf(storageHead, '<Object><Key>${key}</Key></Object>'),
				description:
					'Listed keys are inserted into the XML body without escapeXml, so a key containing & or < makes the request malformed and the objects remain.'
			},
			{
				path: 'src/storage.ts',
				lines: lineOf(storageHead, "contentType === 'application/xml'"),
				description:
					'A per-key error sent as application/xml; charset=UTF-8 stays a string and is reported as a successful delete.'
			}
		]
	},
	{
		name: 'ts-unlocked-stage-write',
		description:
			'Completing a skipped stage takes a lock; skip still publishes a stale copy and can revert that completion.',
		base: { 'src/onboarding.ts': onboardingBase },
		head: { 'src/onboarding.ts': onboardingHead },
		pullRequest: {
			title: 'Complete a skipped onboarding stage when its action succeeds',
			body: 'A successful action upgrades a skipped stage to completed. A stage that is already completed stays completed.'
		},
		expected: [
			{
				path: 'src/onboarding.ts',
				lines: [
					lineOf(onboardingHead, 'await this.save(next);')[0],
					lineOfNth(onboardingHead, 'await this.save(next);', 2)[0]
				],
				description:
					'skip copies the stage list and writes it without the gate, so a completion that lands during save can be overwritten with skipped.'
			}
		]
	},
	{
		name: 'ts-audit-label-empty-body',
		description:
			'A 204 delete audits {response.userId}, which the resolver can only read from a body.',
		base: {
			'src/avatars.ts': avatarsBase
		},
		head: { 'src/avatars.ts': avatarsHead },
		pullRequest: {
			title: 'Audit avatar deletion',
			body: 'Deleting an avatar records an audit event for that user, using the same label shape as create.'
		},
		expected: [
			{
				path: 'src/avatars.ts',
				lines: lineOf(avatarsHead, "record('avatars.delete {response.userId}', null"),
				description:
					'The delete returns no body, so {response.userId} resolves to an empty id and record() drops the audit.'
			}
		]
	},
	{
		name: 'ts-served-type-mismatch',
		description:
			'An avatar named .png is stored and served as image/png when its bytes are not a PNG.',
		base: { 'src/avatars.ts': avatarBytesBase },
		head: { 'src/avatars.ts': avatarBytesHead },
		pullRequest: {
			title: 'Accept PNG, JPEG, and WebP avatars',
			body: 'Uploads are limited to those extensions and stored as PNG. If transcoding fails, the original upload is kept.'
		},
		expected: [
			{
				path: 'src/avatars.ts',
				lines: lineOf(avatarBytesHead, "return { contentType: 'image/png', bytes }"),
				description:
					'A file named photo.png whose bytes are SVG fails toPng and is served as image/png anyway.'
			}
		]
	},
	{
		name: 'clean-mirrored-assertion',
		description: 'A test asserts the configured constant directly. Any comment is noise.',
		base: { 'src/queue.ts': queueBase },
		head: { 'src/queue.test.ts': queueTest },
		pullRequest: { title: 'Cover spare delivery' },
		expected: []
	}
];
