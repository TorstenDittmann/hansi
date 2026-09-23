import type { EvalCase } from '../types';

/** 1-based line range of the first line containing `needle`, so expectations track the code. */
function lineOf(content: string, needle: string): [number, number] {
	const index = content.split('\n').findIndex((line) => line.includes(needle));
	if (index === -1) throw new Error(`"${needle}" not found`);
	return [index + 1, index + 1];
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
	}
];
