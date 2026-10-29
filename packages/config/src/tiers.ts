/** Merge confidence for a whole pull request, best to worst. */
export const tiers = ['S', 'A', 'B', 'C', 'D', 'F'] as const;
export type Tier = (typeof tiers)[number];

export const tierMeaning: Record<Tier, string> = {
	S: 'Ready to merge',
	A: 'Mergeable after minor fixes',
	B: 'Needs changes before merging',
	C: 'Significant problems',
	D: 'Serious problems',
	F: 'Do not merge'
};

/** Whether a tier is good enough to merge without further changes. */
export function isMergeableTier(tier: Tier): boolean {
	return tier === 'S' || tier === 'A';
}

export const verdicts = ['approve', 'request_changes', 'comment'] as const;
export type Verdict = (typeof verdicts)[number];

export const verdictLabel: Record<Verdict, string> = {
	approve: 'Approved',
	request_changes: 'Changes requested',
	comment: 'Commented'
};
