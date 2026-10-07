/**
 * A minimal client for the Docker Engine API: just what a review sandbox needs. It talks to the
 * daemon over a unix socket (`unix:///path`) or plain TCP (`tcp://host:port`).
 */
export class DockerError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(`Docker API ${status}: ${message}`);
	}
}

const API_VERSION = 'v1.44';

export interface ExecResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export function dockerClient(host: string) {
	const unix = host.startsWith('unix://') ? host.slice('unix://'.length) : undefined;
	const base = unix ? 'http://docker' : host.replace(/^tcp:\/\//, 'http://');

	const request = async (
		method: string,
		path: string,
		options: { query?: Record<string, string>; body?: unknown; signal?: AbortSignal } = {}
	) => {
		const url = new URL(`${base}/${API_VERSION}${path}`);
		for (const [key, value] of Object.entries(options.query ?? {})) {
			url.searchParams.set(key, value);
		}
		const raw = options.body instanceof Uint8Array;
		const response = await fetch(url, {
			method,
			unix,
			signal: options.signal,
			headers: options.body
				? { 'content-type': raw ? 'application/x-tar' : 'application/json' }
				: undefined,
			body: raw
				? (options.body as Uint8Array)
				: options.body
					? JSON.stringify(options.body)
					: undefined
		} as RequestInit);
		if (!response.ok) {
			const text = await response.text();
			let message = text;
			try {
				message = (JSON.parse(text) as { message?: string }).message ?? text;
			} catch {
				// Not JSON: keep the raw text.
			}
			throw new DockerError(response.status, message.trim());
		}
		return response;
	};

	return {
		async hasImage(image: string): Promise<boolean> {
			try {
				await request('GET', `/images/${encodeURIComponent(image)}/json`);
				return true;
			} catch (error) {
				if (error instanceof DockerError && error.status === 404) return false;
				throw error;
			}
		},

		/** Pulls an image. Errors arrive inside the progress stream, not as an HTTP status. */
		async pull(image: string): Promise<void> {
			const response = await request('POST', '/images/create', {
				query: { fromImage: image }
			});
			const text = await response.text();
			for (const line of text.split('\n')) {
				if (!line.trim()) continue;
				const event = JSON.parse(line) as { error?: string };
				if (event.error) throw new DockerError(500, `pulling ${image}: ${event.error}`);
			}
		},

		async create(name: string, spec: Record<string, unknown>): Promise<string> {
			const response = await request('POST', '/containers/create', { query: { name }, body: spec });
			return ((await response.json()) as { Id: string }).Id;
		},

		/** Extracts a tar archive into the container's filesystem at `path`. */
		async putArchive(id: string, path: string, tar: Uint8Array): Promise<void> {
			await request('PUT', `/containers/${id}/archive`, { query: { path }, body: tar });
		},

		async start(id: string): Promise<void> {
			await request('POST', `/containers/${id}/start`);
		},

		async remove(id: string): Promise<void> {
			try {
				await request('DELETE', `/containers/${id}`, { query: { force: 'true' } });
			} catch (error) {
				// Already gone, e.g. removed when its lifetime ran out.
				if (error instanceof DockerError && error.status === 404) return;
				throw error;
			}
		},

		async exec(
			id: string,
			cmd: string[],
			options: { workdir?: string; signal?: AbortSignal } = {}
		): Promise<ExecResult> {
			const created = await request('POST', `/containers/${id}/exec`, {
				body: { Cmd: cmd, WorkingDir: options.workdir, AttachStdout: true, AttachStderr: true }
			});
			const execId = ((await created.json()) as { Id: string }).Id;
			const started = await request('POST', `/exec/${execId}/start`, {
				body: { Detach: false, Tty: false },
				signal: options.signal
			});
			const { stdout, stderr } = demultiplex(new Uint8Array(await started.arrayBuffer()));
			const inspect = await request('GET', `/exec/${execId}/json`);
			const { ExitCode } = (await inspect.json()) as { ExitCode: number | null };
			return { exitCode: ExitCode, stdout, stderr };
		}
	};
}

export type DockerClient = ReturnType<typeof dockerClient>;

/**
 * Splits Docker's multiplexed attach stream: each frame is an 8-byte header (stream type, three
 * zero bytes, big-endian payload length) followed by the payload.
 */
export function demultiplex(data: Uint8Array): { stdout: string; stderr: string } {
	const out: Uint8Array[] = [];
	const err: Uint8Array[] = [];
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	let offset = 0;
	while (offset + 8 <= data.length) {
		const stream = data[offset];
		const length = view.getUint32(offset + 4);
		const payload = data.subarray(offset + 8, offset + 8 + length);
		(stream === 2 ? err : out).push(payload);
		offset += 8 + length;
	}
	const decode = (chunks: Uint8Array[]) => new TextDecoder().decode(Buffer.concat(chunks));
	return { stdout: decode(out), stderr: decode(err) };
}
