import { eq } from 'drizzle-orm';
import { schema, type Database } from '@hans/db';
import { decryptSecret, encryptSecret } from '@hans/llm';

export interface GitHubAppCredentials {
	appId: string;
	slug: string;
	privateKey: string;
	webhookSecret: string;
	clientId: string;
	clientSecret: string;
}

const SETTINGS_KEY = 'github_app';

type CredentialEnv = {
	GITHUB_APP_ID?: string;
	GITHUB_APP_SLUG?: string;
	GITHUB_APP_PRIVATE_KEY?: string;
	GITHUB_WEBHOOK_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	HANS_ENCRYPTION_KEY: string;
};

function fromEnv(env: CredentialEnv): GitHubAppCredentials | null {
	const {
		GITHUB_APP_ID,
		GITHUB_APP_SLUG,
		GITHUB_APP_PRIVATE_KEY,
		GITHUB_WEBHOOK_SECRET,
		GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET
	} = env;
	if (
		!GITHUB_APP_ID ||
		!GITHUB_APP_SLUG ||
		!GITHUB_APP_PRIVATE_KEY ||
		!GITHUB_WEBHOOK_SECRET ||
		!GITHUB_CLIENT_ID ||
		!GITHUB_CLIENT_SECRET
	) {
		return null;
	}
	return {
		appId: GITHUB_APP_ID,
		slug: GITHUB_APP_SLUG,
		// Env files often carry the PEM with literal `\n`.
		privateKey: GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
		webhookSecret: GITHUB_WEBHOOK_SECRET,
		clientId: GITHUB_CLIENT_ID,
		clientSecret: GITHUB_CLIENT_SECRET
	};
}

/** Env vars take precedence; otherwise the credentials stored by the manifest setup flow. */
export async function loadGitHubAppCredentials(
	db: Database,
	env: CredentialEnv
): Promise<GitHubAppCredentials | null> {
	const fromEnvironment = fromEnv(env);
	if (fromEnvironment) return fromEnvironment;

	const [row] = await db
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, SETTINGS_KEY));
	if (!row) return null;

	const plaintext = await decryptSecret(
		row.value as string,
		env.HANS_ENCRYPTION_KEY,
		`settings:${SETTINGS_KEY}`
	);
	return JSON.parse(plaintext) as GitHubAppCredentials;
}

export async function saveGitHubAppCredentials(
	db: Database,
	encryptionKey: string,
	credentials: GitHubAppCredentials
): Promise<void> {
	const value = await encryptSecret(
		JSON.stringify(credentials),
		encryptionKey,
		`settings:${SETTINGS_KEY}`
	);
	await db
		.insert(schema.settings)
		.values({ key: SETTINGS_KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}
