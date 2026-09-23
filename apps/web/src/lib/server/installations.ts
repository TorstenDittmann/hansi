import { schema, type Database } from '@hans/db';
import { getGitHubApp, type GitHubAppCredentials } from '@hans/github';
import { eq, inArray, notInArray, and, sql } from 'drizzle-orm';

export interface InstallationInfo {
	id: number;
	accountLogin: string;
	accountType: string;
}

export interface RepositoryInfo {
	id: number;
	fullName: string;
	private: boolean;
}

/**
 * Upserts an installation. With `organizationId`, it claims the installation for that organization
 * unless another organization already owns it: each installation belongs to one organization, and
 * only disconnecting it there frees it up. Returns the owning organization afterwards.
 */
export async function upsertInstallation(
	db: Database,
	installation: InstallationInfo,
	organizationId?: string
) {
	const [row] = await db
		.insert(schema.githubInstallations)
		.values({ ...installation, organizationId })
		.onConflictDoUpdate({
			target: schema.githubInstallations.id,
			set: {
				accountLogin: installation.accountLogin,
				accountType: installation.accountType,
				...(organizationId
					? {
							organizationId: sql`coalesce(${schema.githubInstallations.organizationId}, excluded.organization_id)`
						}
					: {})
			}
		})
		.returning({ organizationId: schema.githubInstallations.organizationId });
	return row?.organizationId ?? null;
}

export async function upsertRepositories(
	db: Database,
	installationId: number,
	repositories: RepositoryInfo[]
) {
	if (repositories.length === 0) return;
	await db
		.insert(schema.repositories)
		.values(repositories.map((repo) => ({ ...repo, installationId })))
		.onConflictDoUpdate({
			target: schema.repositories.id,
			set: {
				installationId,
				fullName: sql`excluded.full_name`,
				private: sql`excluded.private`
			}
		});
}

/**
 * Fetches an installation and its repositories from GitHub and links it to an organization, if no
 * other organization owns it. Returns whether it now belongs to `organizationId`.
 */
export async function syncInstallation(
	db: Database,
	credentials: GitHubAppCredentials,
	installationId: number,
	organizationId: string
) {
	const app = getGitHubApp(credentials);
	const { data } = await app.octokit.rest.apps.getInstallation({ installation_id: installationId });
	const account = data.account;
	const owner = await upsertInstallation(
		db,
		{
			id: data.id,
			accountLogin: account ? ('login' in account ? account.login : account.slug) : 'unknown',
			accountType: data.target_type
		},
		organizationId
	);
	if (owner !== organizationId) return false;

	const octokit = await app.getInstallationOctokit(installationId);
	const repos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
		per_page: 100
	});
	await upsertRepositories(
		db,
		installationId,
		repos.map((repo) => ({ id: repo.id, fullName: repo.full_name, private: repo.private }))
	);

	// Drop repositories that were removed from the installation while we weren't listening.
	const ids = repos.map((repo) => repo.id);
	await db
		.delete(schema.repositories)
		.where(
			ids.length
				? and(
						eq(schema.repositories.installationId, installationId),
						notInArray(schema.repositories.id, ids)
					)
				: eq(schema.repositories.installationId, installationId)
		);
	return true;
}

/** Installation ids the signed-in GitHub user can administer, via their user access token. */
export async function listUserInstallationIds(accessToken: string): Promise<number[]> {
	const ids: number[] = [];
	for (let page = 1; ; page++) {
		const response = await fetch(
			`https://api.github.com/user/installations?per_page=100&page=${page}`,
			{
				headers: {
					authorization: `Bearer ${accessToken}`,
					accept: 'application/vnd.github+json',
					'x-github-api-version': '2022-11-28'
				}
			}
		);
		if (!response.ok) throw new Error(`GitHub returned ${response.status} listing installations`);
		const body = (await response.json()) as { installations: { id: number }[] };
		ids.push(...body.installations.map((i) => i.id));
		if (body.installations.length < 100) return ids;
	}
}

export async function removeRepositories(db: Database, ids: number[]) {
	if (ids.length) await db.delete(schema.repositories).where(inArray(schema.repositories.id, ids));
}
