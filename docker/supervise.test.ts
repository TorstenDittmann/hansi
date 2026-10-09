import { expect, test } from 'bun:test';
import { supervise, type SupervisedChild } from './supervise';

function delay() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeChild(drain: boolean) {
	let resolveExit: (code: number) => void = () => {};
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const signals: NodeJS.Signals[] = [];
	const child: SupervisedChild & { signals: NodeJS.Signals[]; exit: (code?: number) => void } = {
		drain,
		signals,
		exited,
		exit(code = 0) {
			resolveExit(code);
		},
		kill(signal) {
			signals.push(signal);
		}
	};
	return child;
}

test('a shutdown lets the worker finish after the web process exits', async () => {
	const web = fakeChild(false);
	const worker = fakeChild(true);
	let stop: (signal: NodeJS.Signals) => void = () => {};
	let settled = false;
	const done = supervise([web, worker], (onSignal) => {
		stop = onSignal;
	}).then((code) => {
		settled = true;
		return code;
	});

	stop('SIGTERM');
	expect(web.signals).toEqual(['SIGTERM']);
	expect(worker.signals).toEqual(['SIGTERM']);

	web.exit(0);
	await delay();
	expect(settled).toBe(false);
	expect(worker.signals).toEqual(['SIGTERM']);

	worker.exit(0);
	expect(await done).toBe(0);
	expect(worker.signals).toEqual(['SIGTERM']);
	expect(web.signals).toEqual(['SIGTERM', 'SIGKILL']);
});

test('a second signal is forwarded so the worker can stop immediately', async () => {
	const web = fakeChild(false);
	const worker = fakeChild(true);
	let stop: (signal: NodeJS.Signals) => void = () => {};
	const done = supervise([web, worker], (onSignal) => {
		stop = onSignal;
	});

	stop('SIGTERM');
	stop('SIGTERM');
	expect(worker.signals).toEqual(['SIGTERM', 'SIGTERM']);

	web.exit(0);
	worker.exit(1);
	expect(await done).toBe(0);
});

test('a child exiting on its own stops the others', async () => {
	const web = fakeChild(false);
	const worker = fakeChild(true);
	const done = supervise([web, worker], () => {});

	web.exit(1);
	await delay();
	expect(worker.signals).toEqual(['SIGTERM']);

	worker.exit(0);
	expect(await done).toBe(1);
});

test('once the worker finishes, a web process that is still up is stopped', async () => {
	const web = fakeChild(false);
	const worker = fakeChild(true);
	let stop: (signal: NodeJS.Signals) => void = () => {};
	const done = supervise([web, worker], (onSignal) => {
		stop = onSignal;
	});

	stop('SIGTERM');
	worker.exit(0);
	await delay();
	expect(web.signals).toEqual(['SIGTERM', 'SIGKILL']);
	expect(worker.signals).toEqual(['SIGTERM']);

	web.exit(137);
	expect(await done).toBe(0);
});
