import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase, type Database } from './client';

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(db: Database, folder = migrationsFolder) {
	await migrate(db, { migrationsFolder: folder });
}

if (import.meta.main) {
	const { db, client, ready } = createDatabase({
		url: process.env.DATABASE_URL ?? 'file:./data/hans.db',
		authToken: process.env.DATABASE_AUTH_TOKEN || undefined
	});
	await ready;
	await runMigrations(db);
	client.close();
	console.log('Migrations applied');
}
