import { createDatabase } from './client';
import { runMigrations } from './migrate';

/** Fresh, fully migrated in-memory database. Intended for tests. */
export async function createTestDatabase() {
	const database = createDatabase({ url: ':memory:' });
	await database.ready;
	await runMigrations(database.db);
	return database;
}
