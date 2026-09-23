function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What a comment asks of the bot: `review` for `@slug review`, `chat` for any other mention, or
 * `null` when the bot isn't mentioned. Mentions inside code spans and quotes are ignored.
 */
export function classifyMention(body: string, slug: string): 'review' | 'chat' | null {
	const text = body
		.replace(/```[\s\S]*?```/g, '')
		.replace(/`[^`\n]*`/g, '')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('>'))
		.join('\n');
	const mention = `@${escapeRegExp(slug)}(?![\\w-])`;
	if (new RegExp(`${mention}\\s+(full\\s+)?review\\b`, 'i').test(text)) return 'review';
	if (new RegExp(mention, 'i').test(text)) return 'chat';
	return null;
}
