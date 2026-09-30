// Organization-scoped data access for the dashboard. Every query takes `organizationId` and
// filters by it; SQLite has no row-level security, so this module is the tenancy boundary.
import type { ReasoningEffort } from '@hans/config';
import { schema, type ModelRole, type ProviderId } from '@hans/db';
import { encryptSecret, keyHint } from '@hans/llm';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { costSummary } from './costs';
import { getContext } from './context';
import {
	countReviewList,
	listReviewedRepositoryNames,
	queryReviewList,
	type ReviewListOptions
} from './review-list';

export async function listRepositories(organizationId: string) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.repositories.id,
			fullName: schema.repositories.fullName,
			private: schema.repositories.private,
			enabled: schema.repositories.enabled,
			installationId: schema.repositories.installationId,
			suspended: sql<boolean>`${schema.githubInstallations.suspendedAt} is not null`
		})
		.from(schema.repositories)
		.innerJoin(
			schema.githubInstallations,
			eq(schema.githubInstallations.id, schema.repositories.installationId)
		)
		.where(eq(schema.githubInstallations.organizationId, organizationId))
		.orderBy(schema.repositories.fullName);
}

export async function listInstallations(organizationId: string) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.githubInstallations.id,
			accountLogin: schema.githubInstallations.accountLogin,
			accountType: schema.githubInstallations.accountType
		})
		.from(schema.githubInstallations)
		.where(eq(schema.githubInstallations.organizationId, organizationId))
		.orderBy(schema.githubInstallations.accountLogin);
}

/** Unlinks an installation so another organization can claim it. Its repositories stay synced. */
export async function disconnectInstallation(organizationId: string, installationId: number) {
	const { db } = await getContext();
	await db
		.update(schema.githubInstallations)
		.set({ organizationId: null })
		.where(
			and(
				eq(schema.githubInstallations.id, installationId),
				eq(schema.githubInstallations.organizationId, organizationId)
			)
		);
}

/** Turns reviews on or off for repositories, limited to the organization's installations. */
export async function setRepositoriesEnabled(
	organizationId: string,
	repositoryIds: number[],
	enabled: boolean
) {
	if (repositoryIds.length === 0) return;
	const { db } = await getContext();
	const owned = db
		.select({ id: schema.githubInstallations.id })
		.from(schema.githubInstallations)
		.where(eq(schema.githubInstallations.organizationId, organizationId));
	await db
		.update(schema.repositories)
		.set({ enabled })
		.where(
			and(
				inArray(schema.repositories.id, repositoryIds),
				sql`${schema.repositories.installationId} in ${owned}`
			)
		);
}

export async function listReviews(organizationId: string, options: ReviewListOptions = {}) {
	const { db } = await getContext();
	return queryReviewList(db, organizationId, options);
}

export async function countReviews(
	organizationId: string,
	options: Pick<ReviewListOptions, 'query' | 'status' | 'repository'> = {}
) {
	const { db } = await getContext();
	return countReviewList(db, organizationId, options);
}

/** Repository names that have at least one review in this organization. */
export async function listReviewedRepositories(organizationId: string) {
	const { db } = await getContext();
	return listReviewedRepositoryNames(db, organizationId);
}

export async function getReview(organizationId: string, reviewId: string) {
	const { db } = await getContext();
	const [review] = await db
		.select({ review: schema.reviews, repository: schema.repositories.fullName })
		.from(schema.reviews)
		.innerJoin(schema.repositories, eq(schema.repositories.id, schema.reviews.repositoryId))
		.where(and(eq(schema.reviews.id, reviewId), eq(schema.reviews.organizationId, organizationId)));
	if (!review) return null;

	const [findings, events, calls] = await Promise.all([
		db.select().from(schema.reviewFindings).where(eq(schema.reviewFindings.reviewId, reviewId)),
		db
			.select()
			.from(schema.reviewEvents)
			.where(eq(schema.reviewEvents.reviewId, reviewId))
			.orderBy(schema.reviewEvents.id),
		db
			.select()
			.from(schema.llmCalls)
			.where(eq(schema.llmCalls.reviewId, reviewId))
			.orderBy(schema.llmCalls.createdAt)
	]);
	return { ...review.review, repository: review.repository, findings, events, calls };
}

export async function listCredentials(organizationId: string) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.providerCredentials.id,
			provider: schema.providerCredentials.provider,
			label: schema.providerCredentials.label,
			baseUrl: schema.providerCredentials.baseUrl,
			region: schema.providerCredentials.region,
			keyHint: schema.providerCredentials.keyHint,
			lastVerifiedAt: schema.providerCredentials.lastVerifiedAt
		})
		.from(schema.providerCredentials)
		.where(eq(schema.providerCredentials.organizationId, organizationId))
		.orderBy(schema.providerCredentials.createdAt);
}

export async function addCredential(
	organizationId: string,
	input: { provider: ProviderId; label: string; apiKey: string; baseUrl?: string; region?: string }
) {
	const { db, env } = await getContext();
	const id = crypto.randomUUID();
	await db.insert(schema.providerCredentials).values({
		id,
		organizationId,
		provider: input.provider,
		label: input.label,
		baseUrl: input.baseUrl || null,
		region: input.region || null,
		encryptedKey: await encryptSecret(
			input.apiKey,
			env.HANS_ENCRYPTION_KEY,
			`provider_credentials:${id}`
		),
		keyHint: keyHint(input.apiKey),
		lastVerifiedAt: new Date()
	});
	return id;
}

export async function deleteCredential(organizationId: string, credentialId: string) {
	const { db } = await getContext();
	await db
		.delete(schema.providerCredentials)
		.where(
			and(
				eq(schema.providerCredentials.id, credentialId),
				eq(schema.providerCredentials.organizationId, organizationId)
			)
		);
}

export async function listModelAssignments(organizationId: string) {
	const { db } = await getContext();
	return db
		.select()
		.from(schema.modelAssignments)
		.where(eq(schema.modelAssignments.organizationId, organizationId));
}

export async function setModelAssignment(
	organizationId: string,
	role: ModelRole,
	credentialId: string,
	modelId: string,
	reasoningEffort: ReasoningEffort | null
) {
	const { db } = await getContext();
	const [credential] = await db
		.select({ id: schema.providerCredentials.id })
		.from(schema.providerCredentials)
		.where(
			and(
				eq(schema.providerCredentials.id, credentialId),
				eq(schema.providerCredentials.organizationId, organizationId)
			)
		);
	if (!credential) throw new Error('Unknown credential');

	await db
		.insert(schema.modelAssignments)
		.values({ organizationId, role, credentialId, modelId, reasoningEffort })
		.onConflictDoUpdate({
			target: [schema.modelAssignments.organizationId, schema.modelAssignments.role],
			set: { credentialId, modelId, reasoningEffort }
		});
}

export async function clearModelAssignment(organizationId: string, role: ModelRole) {
	const { db } = await getContext();
	await db
		.delete(schema.modelAssignments)
		.where(
			and(
				eq(schema.modelAssignments.organizationId, organizationId),
				eq(schema.modelAssignments.role, role)
			)
		);
}

export async function listLearnings(organizationId: string) {
	const { db } = await getContext();
	return db
		.select({
			id: schema.learnings.id,
			body: schema.learnings.body,
			author: schema.learnings.author,
			sourceUrl: schema.learnings.sourceUrl,
			repository: schema.repositories.fullName,
			createdAt: schema.learnings.createdAt
		})
		.from(schema.learnings)
		.leftJoin(schema.repositories, eq(schema.repositories.id, schema.learnings.repositoryId))
		.where(eq(schema.learnings.organizationId, organizationId))
		.orderBy(desc(schema.learnings.createdAt));
}

export async function addLearning(
	organizationId: string,
	input: { body: string; repositoryId: number | null; author: string | null }
) {
	const { db } = await getContext();
	if (input.repositoryId !== null) {
		const repositories = await listRepositories(organizationId);
		if (!repositories.some((repo) => repo.id === input.repositoryId)) {
			throw new Error('Unknown repository');
		}
	}
	await db.insert(schema.learnings).values({ organizationId, ...input });
}

export async function deleteLearning(organizationId: string, learningId: string) {
	const { db } = await getContext();
	await db
		.delete(schema.learnings)
		.where(
			and(eq(schema.learnings.id, learningId), eq(schema.learnings.organizationId, organizationId))
		);
}

/** Spend and review totals for the overview. Review counts are completed reviews. */
export async function getCostSummary(organizationId: string, now = new Date()) {
	const { db } = await getContext();
	return costSummary(db, organizationId, now);
}
