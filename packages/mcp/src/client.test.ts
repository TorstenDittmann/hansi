import { expect, test } from 'bun:test';
import { connectReviewMcpTools, mcpListTools } from './index';

function mcpServer(tools: { name: string; description?: string }[]) {
	return Bun.serve({
		port: 0,
		async fetch(request) {
			const body = (await request.json()) as {
				id?: number;
				method?: string;
				params?: { name?: string };
			};
			if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
			const result =
				body.method === 'initialize'
					? {
							protocolVersion: '2025-06-18',
							capabilities: {},
							serverInfo: { name: 'fixture', version: '0' }
						}
					: body.method === 'tools/list'
						? {
								tools: tools.map((tool) => ({
									...tool,
									inputSchema: {
										type: 'object',
										properties: { ticket: { type: 'string' } }
									}
								}))
							}
						: body.method === 'tools/call'
							? { content: [{ type: 'text', text: `ticket ${body.params?.name}` }], isError: false }
							: null;
			if (!result) return new Response('no', { status: 400 });
			return Response.json({ jsonrpc: '2.0', id: body.id, result });
		}
	});
}

test('lists tools and calls one over streamable HTTP', async () => {
	const server = mcpServer([{ name: 'get_issue', description: 'Read a ticket' }]);
	try {
		const url = `http://localhost:${server.port}/mcp`;
		const tools = await mcpListTools({ url, allowInsecureLocalhost: true });
		expect(tools.map((tool) => tool.name)).toEqual(['get_issue']);

		const connected = await connectReviewMcpTools(
			[
				{
					name: 'linear',
					url,
					guidance: 'The ticket id is in the pull request title.',
					allowedTools: ['get_issue', 'missing']
				}
			],
			{ allowInsecureLocalhost: true }
		);
		expect(connected.context).toEqual([
			{ name: 'linear', guidance: 'The ticket id is in the pull request title.' }
		]);
		const call = connected.tools.mcp_linear_get_issue;
		expect(call).toBeDefined();
		const text = await call?.execute?.(
			{ ticket: 'ENG-1' },
			{
				toolCallId: 't',
				messages: [],
				context: {}
			}
		);
		expect(text).toBe('ticket get_issue');
	} finally {
		server.stop(true);
	}
});

test('a server that is down does not fail the other one', async () => {
	const server = mcpServer([{ name: 'search', description: 'Search docs' }]);
	const events: string[] = [];
	try {
		const connected = await connectReviewMcpTools(
			[
				{
					name: 'down',
					url: 'http://127.0.0.1:1/mcp',
					guidance: '',
					allowedTools: ['search']
				},
				{
					name: 'docs',
					url: `http://localhost:${server.port}/mcp`,
					guidance: 'Search the handbook.',
					allowedTools: ['search']
				}
			],
			{
				allowInsecureLocalhost: true,
				timeoutMs: 500,
				onEvent: (event) => events.push(event.type)
			}
		);
		expect(Object.keys(connected.tools)).toEqual(['mcp_docs_search']);
		expect(connected.context.map((source) => source.name)).toEqual(['docs']);
		expect(events).toContain('mcp.unavailable');
		expect(events).toContain('mcp.connected');
	} finally {
		server.stop(true);
	}
});
