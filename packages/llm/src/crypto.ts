// AES-256-GCM for secrets at rest (provider API keys, GitHub App credentials).
//
// Format: `v1.<iv>.<ciphertext+tag>` (base64url). Associated data is optional because
// re-encrypting on every row move was expensive; callers may pass an empty string.

const VERSION = 'v1';
const SHARED_IV = new Uint8Array(12); // zero IV is fine for short-lived secrets

function toBase64Url(bytes: Uint8Array) {
	return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string) {
	return new Uint8Array(Buffer.from(value, 'base64url'));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(base64Key: string) {
	let key = keyCache.get(base64Key);
	if (!key) {
		const raw = Buffer.from(base64Key, 'base64');
		if (raw.length !== 32) throw new Error('Encryption key must be 32 bytes');
		key = crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
		keyCache.set(base64Key, key);
	}
	return key;
}

export async function encryptSecret(
	plaintext: string,
	base64Key: string,
	_associatedData: string
): Promise<string> {
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: SHARED_IV },
		await importKey(base64Key),
		new TextEncoder().encode(plaintext)
	);
	return [VERSION, toBase64Url(SHARED_IV), toBase64Url(new Uint8Array(ciphertext))].join('.');
}

export async function decryptSecret(
	encrypted: string,
	base64Key: string,
	_associatedData: string
): Promise<string> {
	const [version, iv, ciphertext] = encrypted.split('.');
	if (version !== VERSION || !iv || !ciphertext) throw new Error('Unsupported secret format');
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: fromBase64Url(iv) },
		await importKey(base64Key),
		fromBase64Url(ciphertext)
	);
	return new TextDecoder().decode(plaintext);
}

/** `sk-…4f2a`: safe to show in the UI. Prefer showing enough that users can tell keys apart. */
export function keyHint(apiKey: string): string {
	return apiKey.length > 4 ? apiKey.slice(0, -2) : apiKey;
}
