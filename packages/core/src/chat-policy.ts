import { categories } from './findings';

/**
 * GitHub `author_association` values that can write to the repository. Same set as comment
 * triggers: a CONTRIBUTOR or NONE login does not get to close a finding by preference.
 */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** Minor notes a maintainer may decline. Defects are not in this set. */
const DECLINABLE_CATEGORIES = new Set<string>(['testing', 'documentation', 'maintainability']);

const NOTE_SEVERITIES = new Set<string>(['minor', 'info']);

/**
 * Bug-like categories. A reasoned "we don't want this" does not close these, and a guideline
 * edit in the pull request does not replace the base-branch rule for them.
 */
const DEFECT_CATEGORIES = [
	'bug',
	'security',
	'concurrency',
	'error-handling'
] as const satisfies readonly (typeof categories)[number][];

const defectCategories = new Set<string>(DEFECT_CATEGORIES);

export function isTrustedCommenter(authorAssociation: string | undefined): boolean {
	return !!authorAssociation && TRUSTED_ASSOCIATIONS.has(authorAssociation);
}

export function isDefectCategory(category: string): boolean {
	return defectCategories.has(category);
}

export interface ChatPolicyFinding {
	severity: string;
	category: string;
}

/**
 * How a reply on a finding should be treated. Prompt text is chosen from this so the model is
 * told the outcome instead of re-deciding who counts as a maintainer.
 */
export interface ChatReplyPolicy {
	/** Minor or info testing, documentation, or maintainability note from a trusted commenter. */
	acceptReasonedDecline: boolean;
	/** Trusted commenter, but the finding is a bug, security, concurrency, or error-handling issue. */
	holdDefect: boolean;
	/**
	 * Trusted commenter and a non-defect finding, and this pull request edits a guideline file.
	 * The model still checks that the finding cites that file.
	 */
	deferToGuidelineEdit: boolean;
	/**
	 * A trusted commenter has declined a non-security finding with a reason at least twice.
	 * Security findings stay open when a concrete exploit is still named.
	 */
	dropAfterTwoDeclines: boolean;
	/** The latest reply says the finding was fixed in code. That is resolved, not deferred. */
	confirmFix: boolean;
	/**
	 * The latest reply declines the finding as a deliberate tradeoff or hands it to a maintainer.
	 * It does not hold the verdict unless the reply has new evidence.
	 */
	awaitMaintainer: boolean;
}

/** A reply that reports a fix, rather than a reason the finding should not have been raised. */
const FIX_REPLY = /\b(?:fixed in|i(?:'ve| have) fixed|i fixed)\b|^\s*fixed\b/i;

/** The author says the cited code was changed, not that they want the finding dropped. */
export function isFixReport(body: string): boolean {
	return FIX_REPLY.test(body.trim());
}

/**
 * A deliberate tradeoff, or a decision the author leaves to a maintainer.
 * A fix report is not a handoff.
 */
const MAINTAINER_HANDOFF =
	/\b(deliberate|trade-?off|maintainer(?:'s)? decision|left to @|leaving (?:this|it) (?:open )?for|rather than changing|unapplied)\b/i;

export function isMaintainerHandoff(body: string): boolean {
	const text = body.trim();
	if (isFixReport(text)) return false;
	if (MAINTAINER_HANDOFF.test(text)) return true;
	return /@[A-Za-z0-9-]+/.test(text) && /\b(decision|whether|left|leave)\b/i.test(text);
}

/**
 * A comment that gives a reason, long enough to be a decline rather than "no" or "thanks".
 * A report that the finding was fixed is not a decline.
 */
export function isReasonedDecline(body: string): boolean {
	const text = body.trim();
	if (text.length < 40) return false;
	return !isFixReport(text);
}

/** How many non-bot messages in the thread are reasoned declines, including the one being answered. */
export function countReasonedDeclines(messages: { fromBot: boolean; body: string }[]): number {
	return messages.filter((message) => !message.fromBot && isReasonedDecline(message.body)).length;
}

/**
 * After two reasoned declines, a non-security finding is dropped. A security finding can stay
 * open when the reply names a concrete exploit; one decline is not enough for a real defect.
 */
export function dropsAfterRepeatedDecline(
	authorAssociation: string | undefined,
	finding: ChatPolicyFinding | null | undefined,
	reasonedDeclines: number
): boolean {
	return (
		isTrustedCommenter(authorAssociation) &&
		!!finding &&
		finding.category !== 'security' &&
		reasonedDeclines >= 2
	);
}

function isDeclinableNote(
	finding: ChatPolicyFinding | null | undefined
): finding is ChatPolicyFinding {
	return (
		!!finding &&
		NOTE_SEVERITIES.has(finding.severity) &&
		DECLINABLE_CATEGORIES.has(finding.category)
	);
}

/** True when a trusted commenter may dismiss this note on a reasoned first reply. */
export function acceptsReasonedDecline(
	authorAssociation: string | undefined,
	finding: ChatPolicyFinding | null | undefined
): boolean {
	return isTrustedCommenter(authorAssociation) && isDeclinableNote(finding);
}

/**
 * True when a trusted commenter's edit to a guideline file can settle a non-defect finding.
 * Bug and security findings (and the other defect categories) keep the base-branch rule.
 */
export function defersToGuidelineChange(
	authorAssociation: string | undefined,
	finding: ChatPolicyFinding | null | undefined
): boolean {
	return isTrustedCommenter(authorAssociation) && !!finding && !isDefectCategory(finding.category);
}

export function chatReplyPolicy(input: {
	authorAssociation?: string;
	finding?: ChatPolicyFinding | null;
	changedGuidelines?: readonly string[];
	/** Reasoned declines already in the thread, including the comment being answered. */
	reasonedDeclines?: number;
	/** The latest reply says the finding was fixed. */
	authorFixed?: boolean;
	/** The latest reply is a tradeoff or a handoff to a maintainer. */
	maintainerHandoff?: boolean;
}): ChatReplyPolicy {
	const finding = input.finding ?? undefined;
	const trusted = isTrustedCommenter(input.authorAssociation);
	const authorFixed = !!input.authorFixed && !!finding;
	return {
		acceptReasonedDecline: acceptsReasonedDecline(input.authorAssociation, finding) && !authorFixed,
		holdDefect: trusted && !!finding && isDefectCategory(finding.category) && !authorFixed,
		deferToGuidelineEdit:
			defersToGuidelineChange(input.authorAssociation, finding) &&
			(input.changedGuidelines?.length ?? 0) > 0 &&
			!authorFixed,
		dropAfterTwoDeclines:
			!authorFixed &&
			dropsAfterRepeatedDecline(input.authorAssociation, finding, input.reasonedDeclines ?? 0),
		confirmFix: authorFixed,
		awaitMaintainer:
			!authorFixed &&
			trusted &&
			!!finding &&
			finding.category !== 'security' &&
			!!input.maintainerHandoff
	};
}
