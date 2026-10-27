/** Turns the raw review events into rows a person can read on the review detail page. */

export interface TraceEvent {
	id: number;
	type: string;
	data: Record<string, unknown> | null;
	createdAt: Date | string | number;
}

export type TraceTone = 'default' | 'ok' | 'warn' | 'error' | 'muted';

export interface TraceItem {
	id: number;
	type: string;
	/** Short name of what happened, such as `Read file`. */
	label: string;
	/** One line on what it touched or decided. Shown in monospace when `mono` is set. */
	summary: string;
	mono: boolean;
	/** Full text the summary cuts short, such as a multi-line command. */
	code?: string;
	/** Small facts shown beside the summary, such as `exit 1` or `2.4s`. */
	meta: string[];
	tone: TraceTone;
	/** Seconds since the first event of the review. */
	offset: number;
	data: Record<string, unknown> | null;
}

export interface TraceSubagent {
	kind: 'subagent';
	agent: string;
	task: string;
	paths: string[];
	start: TraceItem;
	end?: TraceItem;
	items: TraceItem[];
}

export type TraceEntry = { kind: 'event'; item: TraceItem } | TraceSubagent;

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown) => (typeof value === 'number' ? value : undefined);
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const short = (sha: unknown) => str(sha).slice(0, 7);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatMs(ms: number | undefined) {
	if (ms === undefined) return '';
	if (ms < 1000) return `${ms}ms`;
	if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`;
	// Round to whole seconds first so 119.6s reads 2m 0s, not 1m 60s.
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function range(start: unknown, end: unknown) {
	const from = num(start);
	const to = num(end);
	if (from === undefined) return '';
	return to === undefined || to === from ? `${from}` : `${from}-${to}`;
}

function lines(path: string, start: unknown, end: unknown) {
	const span = range(start, end);
	return span ? `${path}:${span}` : path;
}

/** `key: value` pairs of the plain fields, for event types without their own rendering. */
function fallbackSummary(data: Record<string, unknown>) {
	return Object.entries(data)
		.filter(([key, value]) => key !== 'agent' && value !== null && typeof value !== 'object')
		.map(([key, value]) => `${key}: ${value}`)
		.join(' · ');
}

const labels: Record<string, string> = {
	'review.mode': 'Review started',
	'review.merge_only': 'Merge only',
	'review.submitted': 'Model submitted',
	'review.completed': 'Review completed',
	'review.posted': 'Posted to GitHub',
	'config.invalid': 'Invalid config',
	'sandbox.ready': 'Sandbox ready',
	'sandbox.setup': 'Sandbox setup',
	'sandbox.skipped': 'No sandbox',
	'sandbox.failed': 'Sandbox failed',
	'files.filtered': 'Files filtered',
	'files.prompt': 'Prompt files',
	'tool.read_file': 'Read file',
	'tool.grep': 'Search',
	'tool.ast_search': 'AST search',
	'tool.file_history': 'File history',
	'tool.list_refs': 'List refs',
	'tool.path_in_refs': 'Path in refs',
	'tool.list_files': 'List files',
	'tool.run_command': 'Run command',
	'subagent.started': 'Subagent',
	'subagent.completed': 'Subagent done',
	'subagent.failed': 'Subagent failed',
	'subagent.skipped': 'Subagent skipped',
	'verify.completed': 'Verified',
	'finding.placement': 'Placement',
	'finding.relocated': 'Relocated',
	'anchoring.suspicious': 'Anchoring',
	'suggestion.removed': 'Suggestion removed',
	'chat.remember': 'Remembered',
	'chat.mark_finding': 'Marked finding'
};

type Described = Pick<TraceItem, 'summary'> & Partial<Omit<TraceItem, 'summary'>>;

function describe(type: string, d: Record<string, unknown>): Described {
	switch (type) {
		case 'review.mode': {
			const meta = [
				d.openFindings ? plural(Number(d.openFindings), 'open finding') : '',
				d.learnings ? plural(Number(d.learnings), 'learning') : '',
				...list(d.linkedIssues).map((n) => `#${n}`),
				...list(d.failedChecks).map((name) => `failed: ${name}`)
			];
			const summary = d.mergeOnly
				? `Merge-only update since ${short(d.from)}`
				: d.incremental
					? `Incremental review since ${short(d.from)}`
					: `Full review from base ${short(d.from)}`;
			return { summary, meta };
		}
		case 'review.merge_only':
			return {
				summary: `Only ${str(d.baseRef) || 'the base branch'} was merged in; previous review carried over`,
				meta: [str(d.verdict), d.tier ? `tier ${d.tier}` : '']
			};
		case 'review.submitted': {
			const findings = Number(d.findings ?? 0);
			const fromSubagents = Number(d.fromSubagents ?? 0);
			return {
				summary: `${plural(findings, 'finding')}${fromSubagents ? ` (${fromSubagents} from subagents)` : ''}`,
				meta: [
					list(d.resolved).length ? `${list(d.resolved).length} resolved` : '',
					d.tier ? `tier ${d.tier}` : ''
				]
			};
		}
		case 'review.completed':
			return {
				summary: `${plural(Number(d.posted ?? 0), 'comment')} posted, ${Number(d.dropped ?? 0)} dropped, ${Number(d.stillOpen ?? 0)} still open`,
				meta: [str(d.verdict), d.tier ? `tier ${d.tier}` : ''],
				tone: 'ok'
			};
		case 'review.posted':
			return {
				summary: str(d.summaryUrl) || 'Review posted',
				mono: true,
				meta: [
					d.submittedReview ? 'review submitted' : 'comment only',
					d.headMoved ? 'head moved' : '',
					d.dismissedChangeRequests ? `${d.dismissedChangeRequests} dismissed` : ''
				],
				tone: 'ok'
			};
		case 'config.invalid':
			return {
				summary: list(d.errors).map(String).join('; ') || 'The repository config is invalid',
				tone: 'error'
			};
		case 'sandbox.ready':
			return {
				summary: `Started in ${formatMs(num(d.ms))}`,
				meta: [d.omitted ? `${plural(Number(d.omitted), 'file')} omitted` : '']
			};
		case 'sandbox.setup':
			return commandItem(d);
		case 'sandbox.skipped':
			return { summary: str(d.reason), tone: 'muted' };
		case 'sandbox.failed':
			return { summary: str(d.error), tone: 'error' };
		case 'files.filtered': {
			const included = list(d.included).length;
			const excluded = list(d.excluded).length;
			return { summary: `${plural(included, 'file')} to review, ${excluded} excluded` };
		}
		case 'files.prompt': {
			const shown = list(d.shown).length;
			const notShown = list(d.notShown).length;
			return {
				summary: `${plural(shown, 'file')} in the prompt${notShown ? `, ${notShown} too large to show` : ''}`,
				tone: notShown ? 'warn' : 'default'
			};
		}
		case 'tool.read_file':
			return {
				summary: lines(str(d.path), d.startLine, d.endLine),
				mono: true,
				meta: [d.ref === 'base' ? 'base' : '']
			};
		case 'tool.grep':
			return { summary: str(d.pattern), mono: true, meta: [str(d.glob)] };
		case 'tool.ast_search':
			return { summary: str(d.pattern), mono: true, meta: [str(d.language), str(d.path)] };
		case 'tool.file_history':
			return {
				summary: str(d.path),
				mono: true,
				meta: [d.limit ? `last ${d.limit}` : '', d.patches ? 'with patches' : '']
			};
		case 'tool.list_refs':
			return { summary: str(d.pattern) || 'all refs', mono: true };
		case 'tool.path_in_refs':
			return { summary: str(d.path), mono: true, meta: [plural(Number(d.refs ?? 0), 'ref')] };
		case 'tool.list_files':
			return { summary: str(d.path) || '.', mono: true };
		case 'tool.run_command':
			return commandItem(d);
		case 'subagent.started':
			return { summary: str(d.task) };
		case 'subagent.completed':
			return {
				summary: `${plural(Number(d.findings ?? 0), 'finding')}`,
				meta: [formatMs(num(d.ms))],
				tone: 'ok'
			};
		case 'subagent.failed':
			return { summary: str(d.error), meta: [formatMs(num(d.ms))], tone: 'error' };
		case 'subagent.skipped':
			return { summary: str(d.task), meta: [str(d.reason)], tone: 'muted' };
		case 'verify.completed': {
			const verdicts = list(d.verdicts) as { keep?: boolean }[];
			const kept = verdicts.filter((v) => v.keep).length;
			return {
				summary: `Kept ${kept} of ${plural(verdicts.length, 'finding')}`,
				tone: kept < verdicts.length ? 'warn' : 'default'
			};
		}
		case 'finding.placement':
			return {
				summary: `${lines(str(d.path), d.startLine, d.endLine)} ${str(d.title)}`,
				mono: true,
				meta: [d.kept ? 'kept' : 'dropped', str(d.reason)],
				tone: d.kept ? 'warn' : 'error'
			};
		case 'finding.relocated': {
			const from = list(d.from);
			const to = list(d.to);
			return {
				summary: `${str(d.path)} ${str(d.title)}`,
				mono: true,
				meta: [`lines ${range(from[0], from[1])} → ${range(to[0], to[1])}`]
			};
		}
		case 'anchoring.suspicious':
			return {
				summary: `${d.unattached} of ${plural(Number(d.submitted ?? 0), 'finding')} could not be placed on the diff`,
				tone: 'warn'
			};
		case 'suggestion.removed':
			return {
				summary: `${str(d.path)} ${str(d.title)}`,
				mono: true,
				meta: [str(d.reason)],
				tone: 'warn'
			};
		default:
			return { summary: fallbackSummary(d) };
	}
}

function commandItem(d: Record<string, unknown>): Described {
	const command = str(d.command);
	const [first = ''] = command.split('\n');
	const multiline = command.includes('\n');
	const exitCode = num(d.exitCode);
	const failed =
		Boolean(d.error) || d.timedOut === true || (exitCode !== undefined && exitCode !== 0);
	return {
		summary: multiline ? `${first} …` : first,
		mono: true,
		code: multiline || command.length > 120 ? command : undefined,
		meta: [
			d.skipped ? `skipped: ${d.skipped}` : '',
			d.timedOut ? 'timed out' : exitCode !== undefined ? `exit ${exitCode}` : '',
			str(d.error),
			formatMs(num(d.ms))
		],
		tone: d.skipped ? 'muted' : failed ? 'error' : 'default'
	};
}

export function traceItem(event: TraceEvent, startedAt: number): TraceItem {
	const data = event.data ?? {};
	const described = describe(event.type, data);
	return {
		id: event.id,
		type: event.type,
		label: labels[event.type] ?? event.type,
		mono: false,
		tone: 'default',
		...described,
		meta: (described.meta ?? []).filter(Boolean),
		offset: Math.max(0, Math.round((new Date(event.createdAt).getTime() - startedAt) / 1000)),
		data: event.data
	};
}

/**
 * Rows in order, with each subagent's steps folded under the row that started it. Subagents run
 * side by side, so their steps interleave in the raw order; grouping them by `agent` keeps each
 * one readable.
 */
export function buildTrace(events: TraceEvent[]): TraceEntry[] {
	const startedAt = events.length ? new Date(events[0].createdAt).getTime() : 0;
	const entries: TraceEntry[] = [];
	const open = new Map<string, TraceSubagent>();
	for (const event of events) {
		const item = traceItem(event, startedAt);
		const agent = str(event.data?.agent);
		if (event.type === 'subagent.started' && agent) {
			const group: TraceSubagent = {
				kind: 'subagent',
				agent,
				task: str(event.data?.task),
				paths: list(event.data?.paths).map(String),
				start: item,
				items: []
			};
			open.set(agent, group);
			entries.push(group);
			continue;
		}
		const group = agent ? open.get(agent) : undefined;
		if (!group) {
			entries.push({ kind: 'event', item });
			continue;
		}
		if (event.type === 'subagent.completed' || event.type === 'subagent.failed') {
			group.end = item;
			open.delete(agent);
		} else {
			group.items.push(item);
		}
	}
	return entries;
}
