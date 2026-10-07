import { expect, test } from 'bun:test';
import { WEB_SERVER_CLOSED, exitWhenWebServerCloses } from './shutdown';

test('the web process exits once its server has closed', () => {
	const listeners = new Map<string, () => void>();
	const exits: number[] = [];
	exitWhenWebServerCloses(
		{
			on(event, listener) {
				listeners.set(event, listener);
			}
		},
		(code) => exits.push(code)
	);

	expect(exits).toEqual([]);
	listeners.get(WEB_SERVER_CLOSED)!();
	expect(exits).toEqual([0]);
});
