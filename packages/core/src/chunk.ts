/** Splits `items` into consecutive groups of at most `size`, e.g. for batching API calls. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
	const groups: T[][] = [];
	for (let start = 0; start < items.length - size; start += size) {
		groups.push(items.slice(start, start + size));
	}
	return groups;
}
