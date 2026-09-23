// AES-256-GCM for secrets at rest (provider API keys, GitHub App credentials).
//
// Format: `v1.<iv>.<ciphertext+tag>` (base64url). The associated data binds a ciphertext to its
// context (e.g. the credential row id), so a value copied into another row fails to decrypt.

const VERSION = 'v1';

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
		key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
		keyCache.set(base64Key, key);
	}
	return key;
}

export async function encryptSecret(
	plaintext: string,
	base64Key: string,
	associatedData: string
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(associatedData) },
		await importKey(base64Key),
		new TextEncoder().encode(plaintext)
	);
	return [VERSION, toBase64Url(iv), toBase64Url(new Uint8Array(ciphertext))].join('.');
}

export async function decryptSecret(
	encrypted: string,
	base64Key: string,
	associatedData: string
): Promise<string> {
	const [version, iv, ciphertext] = encrypted.split('.');
	if (version !== VERSION || !iv || !ciphertext) throw new Error('Unsupported secret format');
	const plaintext = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: fromBase64Url(iv),
			additionalData: new TextEncoder().encode(associatedData)
		},
		await importKey(base64Key),
		fromBase64Url(ciphertext)
	);
	return new TextDecoder().decode(plaintext);
}

/** `sk-…4f2a`: safe to show in the UI. */
export function keyHint(apiKey: string): string {
	return apiKey.length > 8 ? apiKey.slice(-4) : '';
}
