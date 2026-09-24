/** Commenters allowed to spend API credits: humans need write association. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * Whether a PR comment may trigger a review or chat reply.
 *
 * Humans need owner/member/collaborator association. Other GitHub Apps may too (e.g. Cursor
 * answering a finding), so bots are allowed regardless of association. Our own comments are
 * ignored so we do not loop on ourselves.
 */
export function canTriggerFromComment(
	comment: { user: { login: string; type: string }; author_association: string },
	slug: string
): boolean {
	if (comment.user.type === 'Bot') {
		const login = comment.user.login.replace(/\[bot\]$/i, '');
		return login.toLowerCase() !== slug.toLowerCase();
	}
	return TRUSTED_ASSOCIATIONS.has(comment.author_association);
}
