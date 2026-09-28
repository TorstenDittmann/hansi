import { expect, test } from 'bun:test';
import { createTestDatabase, schema } from '@hans/db';
import { Queue } from '@hans/queue';
import { eq } from 'drizzle-orm';
import { createApiKey, handleMcpRequest, revokeApiKey } from './index';
import { classifyAddress } from './url';

const now = new Date('2026-01-01T00:00:00Z');

async function setup() {
	const { db } = await createTestDatabase();
	await db.insert(schema.organization).values([
		{ id: 'org-a', name: 'Acme', slug: 'acme', createdAt: now },
		{ id: 'org-b', name: 'Other', slug: 'other', createdAt: now }
	]);
	await db.insert(schema.githubInstallations).values({
		id: 1,
		organizationId: 'org-a',
		accountLogin: 'acme',
		accountType: 'Organization',
		createdAt: now,
		updatedAt: now
	});
	await db.insert(schema.repositories).values({
		id: 10,
		installationId: 1,
		fullName: 'acme/web',
		private: false,
		enabled: true,
		createdAt: now,
		updatedAt: now
	});
	await db.insert(schema.reviews).values({
		id: '11111111-1111-4111-8111-111111111111',
		organizationId: 'org-a',
		repositoryId: 10,
		pullNumber: 5,
		headSha: 'abc',
		status: 'completed',
		trigger: 'opened',
		verdict: 'request_changes',
		tier: 'B',
		tierReason: 'A real bug',
		summary: 'Fixes rounding, but drops a cent.',
		createdAt: now
	});
	await db.insert(schema.reviewFindings).values({
		id: '22222222-2222-4222-8222-222222222222',
		reviewId: '11111111-1111-4111-8111-111111111111',
		path: 'src/money.ts',
		startLine: 4,
		endLine: 4,
		severity: 'major',
		category: 'bug',
		title: 'Rounds the wrong way',
		body: 'Half cents go to the customer.',
		suggestion: 'return roundHalfUp(value)',
		status: 'posted'
	});
	const key = await createApiKey(db, {
		organizationId: 'org-a',
		name: 'laptop',
		scopes: ['read', 'write']
	});
	const readOnly = await createApiKey(db, {
		organizationId: 'org-a',
		name: 'ci',
		scopes: ['read']
	});
	return { db, queue: new Queue(db), secret: key.secret, readOnly: readOnly.secret };
}

function call(
	deps: { db: Awaited<ReturnType<typeof setup>>['db']; queue: Queue },
	token: string | null,
	body: unknown
) {
	return handleMcpRequest(
		new Request('https://hansi.example/api/mcp', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
				...(token ? { authorization: `Bearer ${token}` } : {})
			},
			body: JSON.stringify(body)
		}),
		deps
	);
}

async function tool(
	deps: Awaited<ReturnType<typeof setup>>,
	token: string,
	name: string,
	args: Record<string, unknown> = {}
) {
	const response = await call(deps, token, {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/call',
		params: { name, arguments: args }
	});
	const body = (await response.json()) as {
		result?: { content?: { text: string }[]; isError?: boolean };
		error?: { message: string };
	};
	const text = body.result?.content?.[0]?.text ?? '';
	return {
		status: response.status,
		isError: body.result?.isError ?? false,
		error: body.error?.message,
		json: body.result?.isError || !text ? null : (JSON.parse(text) as Record<string, unknown>),
		text
	};
}

test('initialize describes the server and lists tools', async () => {
	const deps = await setup();
	const response = await call(deps, deps.secret, {
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: {
			protocolVersion: '2025-03-26',
			capabilities: {},
			clientInfo: { name: 'test', version: '0' }
		}
	});
	const body = (await response.json()) as {
		result: { protocolVersion: string; instructions: string };
	};
	expect(response.status).toBe(200);
	expect(body.result.protocolVersion).toBe('2025-03-26');
	expect(body.result.instructions).toContain('Tier S');

	const listed = await call(deps, deps.secret, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
	const tools = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools;
	expect(tools.map((entry) => entry.name)).toContain('get_pull_request');
	expect(tools.map((entry) => entry.name)).toContain('trigger_review');
});

test('rejects a missing, revoked, or unknown key', async () => {
	const deps = await setup();
	expect((await call(deps, null, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
	expect(
		(await call(deps, 'hsk_not-a-real-key-value-at-all', { jsonrpc: '2.0', id: 1, method: 'ping' }))
			.status
	).toBe(401);

	const [laptop] = await deps.db
		.select()
		.from(schema.apiKeys)
		.where(eq(schema.apiKeys.name, 'laptop'));
	await revokeApiKey(deps.db, 'org-a', laptop!.id);
	expect((await call(deps, deps.secret, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(
		401
	);
});

test('notifications get an empty 202 and unknown methods are JSON-RPC errors', async () => {
	const deps = await setup();
	const notification = await call(deps, deps.secret, {
		jsonrpc: '2.0',
		method: 'notifications/initialized'
	});
	expect(notification.status).toBe(202);
	expect(await notification.text()).toBe('');

	const missing = await call(deps, deps.secret, { jsonrpc: '2.0', id: 1, method: 'nope' });
	const body = (await missing.json()) as { error: { code: number } };
	expect(body.error.code).toBe(-32601);
	const parsed = await handleMcpRequest(
		new Request('https://hansi.example/api/mcp', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${deps.secret}`,
				accept: 'application/json, text/event-stream',
				'content-type': 'application/json'
			},
			body: '{'
		}),
		deps
	);
	expect(parsed.status).toBe(400);
	expect((await handleMcpRequest(new Request('https://hansi.example/api/mcp'), deps)).status).toBe(
		405
	);
});

test('reads reviews and findings for this organization only', async () => {
	const deps = await setup();
	const me = await tool(deps, deps.secret, 'whoami');
	expect(me.json).toMatchObject({ organization: { slug: 'acme' }, key: { name: 'laptop' } });

	const pull = await tool(deps, deps.secret, 'get_pull_request', {
		repository: 'ACME/web',
		pullNumber: 5
	});
	expect(pull.isError).toBe(false);
	expect(pull.json).toMatchObject({
		repository: 'acme/web',
		latestReview: { tier: 'B', tierMeaning: 'Needs changes before merging' }
	});
	const open = pull.json?.openFindings as { title: string; suggestion: string }[];
	expect(open.map((finding) => finding.title)).toEqual(['Rounds the wrong way']);
	expect(open[0]?.suggestion).toBe('return roundHalfUp(value)');

	const other = await tool(deps, deps.secret, 'get_review', {
		reviewId: '33333333-3333-4333-8333-333333333333'
	});
	expect(other.isError).toBe(true);
});

test('a read-only key cannot trigger a review or save a learning', async () => {
	const deps = await setup();
	const denied = await tool(deps, deps.readOnly, 'trigger_review', {
		repository: 'acme/web',
		pullNumber: 5
	});
	expect(denied.isError).toBe(true);
	expect(denied.text).toContain('write');

	const queued = await tool(deps, deps.secret, 'trigger_review', {
		repository: 'acme/web',
		pullNumber: 9
	});
	expect(queued.isError).toBe(false);
	expect(queued.json).toMatchObject({
		review: { status: 'queued', pullNumber: 9, trigger: 'manual' }
	});

	const learning = await tool(deps, deps.secret, 'create_learning', {
		body: "Don't flag missing error handling in scripts/."
	});
	expect(learning.isError).toBe(false);
	const listed = await tool(deps, deps.readOnly, 'list_learnings');
	expect(listed.json).toMatchObject({
		learnings: [{ body: "Don't flag missing error handling in scripts/.", repository: null }]
	});
});

test('refuses private and metadata MCP server URLs unless the instance opts in', async () => {
	const { assertSafeMcpUrl, McpUrlError } = await import('./url');
	expect(classifyAddress('169.254.169.254')).toBe('metadata');
	expect(classifyAddress('10.1.2.3')).toBe('private');
	expect(classifyAddress('8.8.8.8')).toBe('public');

	await expect(assertSafeMcpUrl('https://10.1.2.3/mcp')).rejects.toBeInstanceOf(McpUrlError);
	await expect(assertSafeMcpUrl('http://example.com/mcp')).rejects.toBeInstanceOf(McpUrlError);
	await expect(assertSafeMcpUrl('https://169.254.169.254/')).rejects.toBeInstanceOf(McpUrlError);
	await expect(
		assertSafeMcpUrl('https://metadata.google.internal/mcp', { allowPrivate: true })
	).rejects.toBeInstanceOf(McpUrlError);
	await expect(
		assertSafeMcpUrl('https://10.1.2.3/mcp', { allowPrivate: true })
	).resolves.toBeInstanceOf(URL);
	await expect(
		assertSafeMcpUrl('http://localhost:3000/mcp', { allowInsecureLocalhost: true })
	).resolves.toBeInstanceOf(URL);
	await expect(
		assertSafeMcpUrl('https://mcp.example.com/mcp', {
			lookup: async () => [{ address: '1.1.1.1' }]
		})
	).resolves.toBeInstanceOf(URL);
	await expect(
		assertSafeMcpUrl('https://internal.example.com/mcp', {
			lookup: async () => [{ address: '10.0.0.5' }]
		})
	).rejects.toBeInstanceOf(McpUrlError);
});
