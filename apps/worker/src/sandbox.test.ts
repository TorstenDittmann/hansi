import { expect, test } from 'bun:test';
import { demultiplex } from './docker';
import { sandboxSkipReason } from './sandbox';

test('every review gets a sandbox unless the instance turns it off', () => {
	expect(sandboxSkipReason({ SANDBOX: 'on' })).toBeNull();
	expect(sandboxSkipReason({ SANDBOX: 'off' })).toBe('SANDBOX=off on this instance');
});

test('demultiplex splits Docker frames into stdout and stderr', () => {
	const frame = (stream: number, text: string) => {
		const payload = new TextEncoder().encode(text);
		const header = new Uint8Array(8);
		header[0] = stream;
		new DataView(header.buffer).setUint32(4, payload.length);
		return [...header, ...payload];
	};
	const data = new Uint8Array([...frame(1, 'one\n'), ...frame(2, 'oops\n'), ...frame(1, 'two\n')]);
	expect(demultiplex(data)).toEqual({ stdout: 'one\ntwo\n', stderr: 'oops\n' });
});
