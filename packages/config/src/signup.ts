export interface SignupCandidate {
	githubLogin?: string | null;
	existingUsers: number;
	hasPendingInvitation: boolean;
	/** True when the request carries a cookie for an active organization invite link. */
	hasInviteLink?: boolean;
}

export interface SignupPolicy {
	mode: 'restricted' | 'open';
	allowedGithubUsers: string[];
}

/**
 * Whether a new account may be created. A restricted instance always admits the first user, who
 * is the person who set it up and owns the GitHub App.
 */
export function canSignUp(policy: SignupPolicy, candidate: SignupCandidate): boolean {
	if (policy.mode === 'open') return true;
	if (candidate.existingUsers === 0) return true;
	if (candidate.hasPendingInvitation || candidate.hasInviteLink) return true;
	const login = candidate.githubLogin?.toLowerCase();
	return !!login && policy.allowedGithubUsers.includes(login);
}
