import { severities, tiers, type Severity, type Tier } from '@hans/config';

export { tierMeaning, tiers, type Tier } from '@hans/config';

/** The best tier a PR can get with a finding of this severity still open. */
const capBySeverity: Record<Severity, Tier> = {
	info: 'A',
	minor: 'B',
	major: 'C',
	critical: 'D'
};

/** Best tier allowed by the open findings: the worst severity decides. */
export function tierCap(openSeverities: Severity[]): Tier {
	const worst = openSeverities.reduce<Severity | null>(
		(acc, s) => (acc === null || severities.indexOf(s) > severities.indexOf(acc) ? s : acc),
		null
	);
	return worst ? capBySeverity[worst] : 'S';
}

/** The model's grade, but never better than the findings allow. */
export function finalTier(modelTier: Tier | undefined, cap: Tier): Tier {
	if (!modelTier) return cap;
	return tiers.indexOf(modelTier) > tiers.indexOf(cap) ? modelTier : cap;
}
