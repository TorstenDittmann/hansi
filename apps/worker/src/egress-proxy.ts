import { lookup } from 'node:dns/promises';
import { isIP, type Socket } from 'node:net';
import { createServer, connect, type Server } from 'node:net';

/**
 * The only way out of a review sandbox. The sandbox has no network of its own; tools inside it
 * use this as their HTTP(S) proxy through a unix socket. It forwards plain HTTP and `CONNECT`
 * tunnels to public addresses on ports 80 and 443, which is what package managers and git need,
 * and refuses everything else: private ranges, loopback, link-local, cloud metadata, and other
 * ports (so no SMTP, SSH, or raw traffic).
 */
const ALLOWED_PORTS = new Set([80, 443]);
const MAX_HEADER_BYTES = 16 * 1024;

const ipv4Blocked: [number, number][] = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
].map(([base, bits]) => [ipv4ToInt(base as string), bits as number]);

function ipv4ToInt(ip: string): number {
	return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

/** Whether an address is somewhere the sandbox must not reach. */
export function isBlockedAddress(ip: string): boolean {
	if (isIP(ip) === 4) {
		const n = ipv4ToInt(ip);
		return ipv4Blocked.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
	}
	const v6 = ip.toLowerCase();
	// IPv4-mapped and NAT64 addresses lead to IPv4 hosts: judge those.
	const embedded = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
	if (embedded) return isBlockedAddress(embedded[1]!);
	return (
		v6 === '::' ||
		v6 === '::1' ||
		/^f[cd]/.test(v6) || // unique local
		/^fe[89ab]/.test(v6) || // link-local
		/^ff/.test(v6) || // multicast
		v6.startsWith('::ffff:') ||
		v6.startsWith('64:ff9b:')
	);
}

/** Resolves a host to an address the sandbox may reach, or throws. Pins the address it checked. */
export async function resolvePublic(host: string): Promise<string> {
	const name = host.replace(/^\[|\]$/g, '');
	const addresses = isIP(name)
		? [{ address: name }]
		: await lookup(name, { all: true, verbatim: true });
	if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
		throw new Error(`${host} is not a public address`);
	}
	return addresses[0]!.address;
}

/** Splits `host:port`, including `[v6]:port`. */
function splitHostPort(value: string, fallbackPort: number): { host: string; port: number } {
	const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(value);
	if (!match) throw new Error(`invalid target ${value}`);
	return { host: match[1]!, port: match[2] ? Number(match[2]) : fallbackPort };
}

function refuse(client: Socket, status: string) {
	client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function handle(client: Socket, head: Buffer, onRequest: (target: string) => void) {
	const headerEnd = head.indexOf('\r\n\r\n');
	const firstLine = head.subarray(0, head.indexOf('\r\n')).toString('latin1');
	const [method, target] = firstLine.split(' ');
	if (!method || !target) return refuse(client, '400 Bad Request');

	let host: string;
	let port: number;
	let forward: Buffer | undefined;
	if (method === 'CONNECT') {
		({ host, port } = splitHostPort(target, 443));
	} else {
		let url: URL;
		try {
			url = new URL(target);
		} catch {
			return refuse(client, '400 Bad Request');
		}
		if (url.protocol !== 'http:') return refuse(client, '400 Bad Request');
		host = url.hostname;
		port = url.port ? Number(url.port) : 80;
		// Origin-form for the server; the rest of the request passes through unchanged.
		const rest = head.subarray(head.indexOf('\r\n'));
		forward = Buffer.concat([
			Buffer.from(
				`${method} ${url.pathname}${url.search} ${firstLine.split(' ')[2] ?? 'HTTP/1.1'}`
			),
			rest
		]);
	}
	onRequest(`${method} ${host}:${port}`);
	if (!ALLOWED_PORTS.has(port)) return refuse(client, '403 Forbidden');

	let address: string;
	try {
		address = await resolvePublic(host);
	} catch {
		return refuse(client, '403 Forbidden');
	}

	const upstream = connect({ host: address, port });
	upstream.once('connect', () => {
		if (method === 'CONNECT') {
			client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			// Bytes the client sent after the CONNECT headers belong to the tunnel.
			const early = head.subarray(headerEnd + 4);
			if (early.length) upstream.write(early);
		} else {
			upstream.write(forward!);
		}
		client.pipe(upstream).pipe(client);
	});
	upstream.on('error', () => {
		if (upstream.readyState === 'opening') refuse(client, '502 Bad Gateway');
		else client.destroy();
	});
	client.on('error', () => upstream.destroy());
	client.on('close', () => upstream.destroy());
}

/** Starts the proxy on a unix socket. */
export async function startEgressProxy(
	socketPath: string,
	onRequest: (target: string) => void = () => {}
): Promise<Server> {
	const server = createServer((client) => {
		let head = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			head = Buffer.concat([head, chunk]);
			const complete = head.includes('\r\n\r\n');
			if (!complete && head.length < MAX_HEADER_BYTES) return;
			client.off('data', onData);
			client.pause();
			if (!complete) return refuse(client, '431 Request Header Fields Too Large');
			handle(client, head, onRequest).catch(() => client.destroy());
		};
		client.on('data', onData);
		client.on('error', () => client.destroy());
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(socketPath, resolve);
	});
	return server;
}
