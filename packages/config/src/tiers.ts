/** Merge confidence for a whole pull request, best to worst. */
export const tiers = ['S', 'A', 'B', 'C', 'D', 'F'] as const;
export type Tier = (typeof tiers)[number];

export const tierMeaning: Record<Tier, string> = {
	S: 'Exemplary: merge with confidence',
	A: 'Safe to merge',
	B: 'Mergeable after minor fixes',
	C: 'Needs changes before merging',
	D: 'Significant problems',
	F: 'Do not merge'
};

export const verdicts = ['approve', 'request_changes', 'comment'] as const;
export type Verdict = (typeof verdicts)[number];

export const verdictLabel: Record<Verdict, string> = {
	approve: 'Approved',
	request_changes: 'Changes requested',
	comment: 'Commented'
};
