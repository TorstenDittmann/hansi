import { resolveDatabaseUrl } from './src/client';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'turso',
	schema: './src/schema/index.ts',
	out: './drizzle',
	dbCredentials: {
		url: resolveDatabaseUrl(process.env.DATABASE_URL ?? 'file:./data/hans.db'),
		authToken: process.env.DATABASE_AUTH_TOKEN
	}
});
