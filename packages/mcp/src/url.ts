import { lookup as dnsLookup } from 'node:dns/promises';

/** Always refused: cloud metadata endpoints are not MCP servers. */
const BLOCKED_HOSTS = new Set([
	'metadata.google.internal',
	'metadata.google.com',
	'metadata.internal'
]);

export interface McpUrlPolicy {
	/** Private-network addresses, and http to them. For a self-hosted instance. */
	allowPrivate?: boolean;
	/** http://localhost, for development. */
	allowInsecureLocalhost?: boolean;
	lookup?: (hostname: string) => Promise<{ address: string }[]>;
}

export class McpUrlError extends Error {}

type AddressKind = 'metadata' | 'private' | 'public' | null;

/**
 * Rejects MCP server URLs that would let a review reach cloud metadata, link-local addresses, or
 * (unless the instance opts in) the rest of the private network. Public http is refused so a
 * bearer token is not sent in the clear.
 */
export async function assertSafeMcpUrl(raw: string, policy: McpUrlPolicy = {}) {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new McpUrlError('Enter a full URL, like https://mcp.example.com/mcp');
	}
	if (url.username || url.password) {
		throw new McpUrlError('The URL must not contain a username or password');
	}
	if (raw.length > 2000) throw new McpUrlError('That URL is too long');
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new McpUrlError('MCP server URLs have to use https');
	}

	const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (!host) throw new McpUrlError('That URL has no host');
	if (BLOCKED_HOSTS.has(host)) throw new McpUrlError('That host is not allowed');
	if (/^\d+$/.test(host)) throw new McpUrlError('Use a hostname or a dotted IP address');

	const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
	const literal = classifyAddress(host);
	if (literal === 'metadata') throw new McpUrlError('That address is not allowed');

	let addresses: { address: string; kind: Exclude<AddressKind, null> }[];
	if (literal) {
		addresses = [{ address: host, kind: literal }];
	} else if (local) {
		addresses = [{ address: '127.0.0.1', kind: 'private' }];
	} else {
		const records = await (policy.lookup ?? defaultLookup)(host).catch(() => {
			throw new McpUrlError(`Could not resolve ${host}`);
		});
		if (records.length === 0) throw new McpUrlError(`Could not resolve ${host}`);
		addresses = records.map((record) => {
			const kind = classifyAddress(record.address);
			if (!kind) throw new McpUrlError(`Could not resolve ${host}`);
			return { address: record.address, kind };
		});
	}

	if (addresses.some((entry) => entry.kind === 'metadata')) {
		throw new McpUrlError('That host is not allowed');
	}
	const reachesPrivate = addresses.some((entry) => entry.kind === 'private');
	const reachesPublic = addresses.some((entry) => entry.kind === 'public');
	if (reachesPrivate && !policy.allowPrivate && !(local && policy.allowInsecureLocalhost)) {
		throw new McpUrlError(
			reachesPublic
				? 'That host resolves to a private address'
				: 'Private addresses are not allowed'
		);
	}
	if (url.protocol === 'http:') {
		const localhostOk = local && policy.allowInsecureLocalhost;
		const privateOk = policy.allowPrivate && reachesPrivate && !reachesPublic;
		if (!localhostOk && !privateOk) throw new McpUrlError('MCP server URLs have to use https');
	}
	return url;
}

async function defaultLookup(hostname: string) {
	const records = await dnsLookup(hostname, { all: true, verbatim: true });
	return records.map((record) => ({ address: record.address }));
}

/** `metadata` is always blocked. `private` is blocked unless the instance opts in. */
export function classifyAddress(address: string): AddressKind {
	const value = address.toLowerCase().replace(/^\[|\]$/g, '');
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
	if (mapped?.[1]) return classifyAddress(mapped[1]);
	if (value === '::' || value === '::1') return 'private';
	if (value === 'fd00:ec2::254') return 'metadata';

	if (value.includes(':')) {
		const first = value.split(':')[0] ?? '';
		if (/^fe[89ab]/.test(first) || /^f[cd]/.test(first)) return 'private';
		return 'public';
	}

	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return null;
	const parts = value.split('.');
	if (parts.some((part) => part.length > 1 && part.startsWith('0'))) return 'private';
	const octets = parts.map(Number);
	if (octets.some((octet) => octet > 255)) return null;
	const a = octets[0] ?? 0;
	const b = octets[1] ?? 0;
	const c = octets[2] ?? 0;
	const d = octets[3] ?? 0;
	if (a === 169 && b === 254 && c === 169 && d === 254) return 'metadata';
	if (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) ||
		a >= 224
	) {
		return 'private';
	}
	return 'public';
}
