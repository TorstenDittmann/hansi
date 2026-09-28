import { assertSafeMcpUrl, type McpUrlPolicy } from './url';

const PROTOCOL = '2025-06-18';
const CLIENT = { name: 'hansi', version: '0.1.0' };

export interface McpClientOptions extends McpUrlPolicy {
	url: string;
	token?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

export interface McpToolInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

interface RpcMessage {
	id?: string | number | null;
	result?: unknown;
	error?: { message?: string };
}

/**
 * One Streamable HTTP session. `initialize` runs on the first call and is reused for the rest of
 * the review, so listing tools and calling them share a connection.
 */
export class McpSession {
	private sessionId: string | null = null;
	private protocol = PROTOCOL;
	private ready: Promise<void> | undefined;
	private nextId = 1;

	constructor(private readonly options: McpClientOptions) {}

	async listTools(): Promise<McpToolInfo[]> {
		await this.init();
		const tools: McpToolInfo[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 5; page++) {
			const result = (await this.rpc('tools/list', cursor ? { cursor } : {})) as {
				tools?: {
					name?: string;
					description?: string;
					inputSchema?: Record<string, unknown>;
				}[];
				nextCursor?: string;
			};
			for (const tool of result.tools ?? []) {
				if (!tool.name) continue;
				tools.push({
					name: tool.name,
					description: tool.description ?? '',
					inputSchema:
						tool.inputSchema && typeof tool.inputSchema === 'object'
							? tool.inputSchema
							: { type: 'object', additionalProperties: true }
				});
			}
			cursor = result.nextCursor;
			if (!cursor) break;
		}
		return tools;
	}

	async callTool(name: string, args: Record<string, unknown>) {
		await this.init();
		const result = (await this.rpc('tools/call', { name, arguments: args })) as {
			content?: { type?: string; text?: string }[];
			isError?: boolean;
		};
		const text = (result.content ?? [])
			.map((part) =>
				part.type === 'text' && part.text ? part.text : part.type ? `[${part.type}]` : ''
			)
			.filter(Boolean)
			.join('\n');
		if (result.isError) throw new Error(text || `The ${name} tool failed`);
		return text || '(empty result)';
	}

	private async init() {
		this.ready ??= this.handshake();
		return this.ready;
	}

	private async handshake() {
		await assertSafeMcpUrl(this.options.url, this.options);
		const result = (await this.rpc('initialize', {
			protocolVersion: PROTOCOL,
			capabilities: {},
			clientInfo: CLIENT
		})) as { protocolVersion?: string };
		if (result.protocolVersion) this.protocol = result.protocolVersion;
		await this.notify('notifications/initialized');
	}

	private notify(method: string) {
		return this.post({ jsonrpc: '2.0', method });
	}

	private async rpc(method: string, params: unknown) {
		const id = this.nextId++;
		const message = await this.post({ jsonrpc: '2.0', id, method, params });
		if (!message) throw new Error('The MCP server returned an empty response');
		if (message.error) throw new Error(message.error.message || 'The MCP server returned an error');
		return message.result ?? {};
	}

	private async post(body: Record<string, unknown>): Promise<RpcMessage | null> {
		const headers: Record<string, string> = {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': this.protocol
		};
		if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
		if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;

		const response = await (this.options.fetch ?? fetch)(this.options.url, {
			method: 'POST',
			redirect: 'error',
			headers,
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000)
		});
		const session = response.headers.get('mcp-session-id');
		if (session) this.sessionId = session;
		const text = await response.text();
		if (response.status === 202 || text.trim() === '') return null;
		if (!response.ok) throw new Error(`The MCP server returned HTTP ${response.status}`);
		return parseRpc(
			response.headers.get('content-type') ?? '',
			text,
			typeof body.id === 'number' || typeof body.id === 'string' ? body.id : null
		);
	}
}

export async function mcpListTools(options: McpClientOptions) {
	return new McpSession(options).listTools();
}

function parseRpc(contentType: string, text: string, id: string | number | null): RpcMessage {
	if (contentType.includes('text/event-stream')) {
		for (const chunk of text.split('\n\n')) {
			const data = chunk
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice(5).trim())
				.join('\n');
			if (!data || data === '[DONE]') continue;
			const message = JSON.parse(data) as RpcMessage;
			if (id === null || message.id === id) return message;
		}
		throw new Error('The MCP server did not return a result');
	}
	const message = JSON.parse(text) as RpcMessage;
	return message;
}
