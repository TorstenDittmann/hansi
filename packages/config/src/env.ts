import { z } from 'zod';

const optional = z
	.string()
	.optional()
	.transform((value) => (value?.trim() ? value : undefined));

export const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

	/**
	 * Public base URL of this instance, used for OAuth callbacks and GitHub webhooks.
	 * (Not `PUBLIC_URL`: SvelteKit hides `PUBLIC_*` variables from server-side private env.)
	 */
	APP_URL: z.url().default('http://localhost:5173'),

	/** `file:./data/hans.db` for a local file, `libsql://…` or `http://…` for sqld/Turso. */
	DATABASE_URL: z.string().min(1).default('file:./data/hans.db'),
	DATABASE_AUTH_TOKEN: optional,

	/** 32 random bytes, base64 encoded. Encrypts provider API keys and GitHub App secrets at rest. */
	HANS_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
		message: 'must be 32 bytes, base64 encoded (generate with `openssl rand -base64 32`)'
	}),
	BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),

	/**
	 * GitHub App credentials. Optional: the setup flow creates the app via the manifest flow and
	 * stores the credentials encrypted in the database. Values set here take precedence.
	 */
	GITHUB_APP_ID: optional,
	GITHUB_APP_SLUG: optional,
	GITHUB_APP_PRIVATE_KEY: optional,
	GITHUB_WEBHOOK_SECRET: optional,
	GITHUB_CLIENT_ID: optional,
	GITHUB_CLIENT_SECRET: optional,

	/**
	 * `restricted` (default, for self-hosting): only the first user, GitHub logins listed in
	 * ALLOWED_GITHUB_USERS, and people with a pending workspace invitation can sign up.
	 * `open`: anyone with a GitHub account can sign up (hosted service).
	 */
	SIGNUP_MODE: z.enum(['restricted', 'open']).default('restricted'),
	ALLOWED_GITHUB_USERS: z
		.string()
		.default('')
		.transform((value) =>
			value
				.split(',')
				.map((login) => login.trim().toLowerCase())
				.filter(Boolean)
		),

	WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
	/** Directory for temporary repository checkouts. */
	WORKER_WORKDIR: optional
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
	const result = envSchema.safeParse(source);
	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
			.join('\n');
		throw new Error(`Invalid environment configuration:\n${issues}`);
	}
	return result.data;
}
