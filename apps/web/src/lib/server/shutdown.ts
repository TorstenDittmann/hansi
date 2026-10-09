/** adapter-node emits this after the HTTP server has closed on SIGTERM or SIGINT. */
export const WEB_SERVER_CLOSED = 'sveltekit:shutdown';

/**
 * Exits once the HTTP server has closed. The open database connection would otherwise keep
 * the process alive, and the orchestrator would then kill the whole container, including a
 * review the worker is still finishing.
 */
export function exitWhenWebServerCloses(
	events: { on: (event: string, listener: () => void) => void },
	exit: (code: number) => void
) {
	events.on(WEB_SERVER_CLOSED, () => exit(0));
}
