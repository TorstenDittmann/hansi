export type SupervisedChild = {
	/**
	 * On shutdown, wait for this child to exit on its own. The worker drains: the first signal
	 * tells it to finish the review it already has.
	 */
	drain: boolean;
	kill: (signal: NodeJS.Signals) => void;
	exited: Promise<number>;
};

/**
 * Runs the web process and the worker together.
 *
 * A deploy sends SIGTERM. The web process exits when its server closes, often while a review
 * is still running. The worker treats a second signal as "drop the in-flight review", so a
 * sibling exiting during shutdown must not signal it again. This waits for draining children
 * to finish, then stops whatever is left so the container can exit.
 *
 * A child that exits on its own (a crash) stops the others and returns that exit code, so the
 * orchestrator restarts the container.
 */
export async function supervise(
	children: SupervisedChild[],
	listen: (onSignal: (signal: NodeJS.Signals) => void) => void
): Promise<number> {
	let shuttingDown = false;

	const signal = (child: SupervisedChild, code: NodeJS.Signals) => {
		try {
			child.kill(code);
		} catch {
			// The child already exited.
		}
	};
	const signalAll = (code: NodeJS.Signals) => {
		for (const child of children) signal(child, code);
	};

	listen((code) => {
		shuttingDown = true;
		// The first call starts a drain. A later call is an explicit force-stop.
		signalAll(code);
	});

	const firstExit = await Promise.race(
		children.map((child) => child.exited.then((code) => ({ code })))
	);

	if (!shuttingDown) {
		signalAll('SIGTERM');
		await Promise.all(children.map((child) => child.exited));
		return firstExit.code;
	}

	await Promise.all(children.filter((child) => child.drain).map((child) => child.exited));
	for (const child of children) {
		if (!child.drain) signal(child, 'SIGKILL');
	}
	await Promise.all(children.map((child) => child.exited));
	// The orchestrator asked us to stop. A zero status is a finished shutdown.
	return 0;
}
