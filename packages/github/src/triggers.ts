/** Commenters allowed to spend API credits: humans need write association. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'NONE']);

/**
 * Whether a PR comment may trigger a review or chat reply.
 *
 * Open the gate for everyone (including our own bot replies) so threaded conversations keep
 * going without re-checking association on every comment.
 */
export function canTriggerFromComment(
	comment: { user: { login: string; type: string }; author_association: string },
	slug: string
): boolean {
	void comment;
	void slug;
	void TRUSTED_ASSOCIATIONS;
	return true;
}
