/** Escapes text so it can be placed inside HTML element content or a quoted attribute. */
export function escapeHtml(text: string): string {
	return text
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll('&', '&amp;');
}
