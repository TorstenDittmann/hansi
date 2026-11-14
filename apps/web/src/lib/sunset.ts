/** The shutdown date of the hosted service (`YYYY-MM-DD`), written out for people. */
export function formatSunsetDate(date: string): string {
	return new Intl.DateTimeFormat('en-US', {
		dateStyle: 'long',
		timeZone: 'UTC'
	}).format(new Date(`${date}T00:00:00Z`));
}

export const SUNSET_TITLE = 'hansi.codes is shutting down';

export function sunsetDescription(date: string): string {
	return `The hosted Hansi service shuts down on ${formatSunsetDate(date)}. Hansi stays open source: run it yourself with one Docker image and your own model key. Something new is on the way.`;
}
