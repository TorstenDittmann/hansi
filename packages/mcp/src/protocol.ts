import type { Database } from '@hans/db';
import type { Queue } from '@hans/queue';
import { authenticateApiKey, bearerToken, touchApiKey, type AuthenticatedKey } from './keys';
import { mcpTools, SERVER_INSTRUCTIONS, ToolError, type McpToolContext } from './tools';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1_000_000;

const tools = mcpTools();

export interface McpHandlerDeps {
	db: Database;
	queue: Queue;
}

/** Streamable HTTP MCP endpoint. Stateless: no session id, one JSON response per request. */
export async function handleMcpRequest(request: Request, deps: McpHandlerDeps): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response(null, { status: 405, headers: { allow: 'POST' } });
	}
	if (!acceptable(request.headers.get('accept'))) {
		return new Response(null, { status: 406 });
	}

	const token = bearerToken(request.headers.get('authorization'));
	const key = token ? await authenticateApiKey(deps.db, token) : null;
	if (!key) return unauthorized();

	let raw: string;
	try {
		raw = await request.text();
	} catch {
		return rpcResponse(rpcError(null, -32700, 'Parse error'), 400);
	}
	if (raw.length > MAX_BODY) {
		return rpcResponse(rpcError(null, -32600, 'Request is too large'), 400);
	}

	let payload: unknown;
	try {
		payload = raw ? JSON.parse(raw) : null;
	} catch {
		return rpcResponse(rpcError(null, -32700, 'Parse error'), 400);
	}

	const messages = Array.isArray(payload) ? payload : [payload];
	if (messages.length === 0) return rpcResponse(rpcError(null, -32600, 'Invalid request'), 400);

	const ctx: McpToolContext = { db: deps.db, queue: deps.queue, key };
	const responses: unknown[] = [];
	for (const message of messages) {
		const response = await dispatch(message, ctx);
		if (response) responses.push(response);
	}
	await touchApiKey(deps.db, key);
	if (responses.length === 0) return new Response(null, { status: 202 });
	return rpcResponse(Array.isArray(payload) ? responses : responses[0], 200);
}

function acceptable(accept: string | null) {
	if (!accept) return true;
	return accept.split(',').some((part) => {
		const type = part.split(';')[0]?.trim();
		return type === 'application/json' || type === 'text/event-stream' || type === '*/*';
	});
}

async function dispatch(message: unknown, ctx: McpToolContext) {
	if (!message || typeof message !== 'object') return rpcError(null, -32600, 'Invalid request');
	const record = message as Record<string, unknown>;
	if (record.jsonrpc !== '2.0' || typeof record.method !== 'string') {
		return rpcError(idOf(record), -32600, 'Invalid request');
	}
	const notification = !('id' in record);
	const id = notification ? undefined : idOf(record);
	if (!notification && typeof id !== 'string' && typeof id !== 'number') {
		return rpcError(null, -32600, 'Invalid request');
	}

	try {
		const result = await handle(record.method, record.params, ctx);
		if (notification || result === undefined) return null;
		return { jsonrpc: '2.0', id, result };
	} catch (error) {
		if (notification) return null;
		if (error instanceof ToolError) {
			return {
				jsonrpc: '2.0',
				id,
				result: { content: [{ type: 'text', text: error.message }], isError: true }
			};
		}
		if (error instanceof RpcError) return rpcError(id ?? null, error.code, error.message);
		return rpcError(id ?? null, -32603, 'Internal error');
	}
}

async function handle(method: string, params: unknown, ctx: McpToolContext) {
	switch (method) {
		case 'initialize':
			return initialize(params);
		case 'ping':
			return {};
		case 'tools/list':
			return {
				tools: tools.map(({ name, description, inputSchema }) => ({
					name,
					description,
					inputSchema
				}))
			};
		case 'tools/call':
			return callTool(params, ctx);
		case 'resources/list':
			return { resources: [] };
		case 'resources/templates/list':
			return { resourceTemplates: [] };
		case 'prompts/list':
			return { prompts: [] };
		case 'notifications/initialized':
		case 'notifications/cancelled':
			return undefined;
		default:
			throw new RpcError(-32601, `Method not found: ${method}`);
	}
}

function initialize(params: unknown) {
	const requested =
		params && typeof params === 'object' && 'protocolVersion' in params
			? String((params as { protocolVersion?: unknown }).protocolVersion ?? '')
			: '';
	const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
	return {
		protocolVersion,
		capabilities: { tools: { listChanged: false } },
		serverInfo: { name: 'hansi', version: '0.1.0' },
		instructions: SERVER_INSTRUCTIONS
	};
}

async function callTool(params: unknown, ctx: McpToolContext) {
	if (
		!params ||
		typeof params !== 'object' ||
		typeof (params as { name?: unknown }).name !== 'string'
	) {
		throw new RpcError(-32602, 'Invalid params');
	}
	const { name, arguments: args } = params as { name: string; arguments?: unknown };
	const found = tools.find((entry) => entry.name === name);
	if (!found) throw new ToolError(`Unknown tool: ${name}`);
	if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
		throw new RpcError(-32602, 'Tool arguments must be an object');
	}
	const value = await found.call(ctx, args ?? {});
	const text = JSON.stringify(value, null, 2);
	return {
		content: [{ type: 'text', text: text.length > 100_000 ? `${text.slice(0, 100_000)}…` : text }],
		isError: false
	};
}

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string
	) {
		super(message);
	}
}

function idOf(record: Record<string, unknown>) {
	const id = record.id;
	return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function rpcError(id: string | number | null, code: number, message: string) {
	return { jsonrpc: '2.0', id, error: { code, message } };
}

function rpcResponse(body: unknown, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function unauthorized() {
	return new Response(JSON.stringify(rpcError(null, -32001, 'Unauthorized')), {
		status: 401,
		headers: {
			'content-type': 'application/json',
			'www-authenticate': 'Bearer'
		}
	});
}

export type { AuthenticatedKey };
