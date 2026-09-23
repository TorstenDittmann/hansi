import { error, json } from '@sveltejs/kit';
import { repoConfigJsonSchema } from '@hans/config';
import type { RequestHandler } from './$types';

/** A published version of the JSON Schema for `.hansi.json`, e.g. `/schema/v1.json`. */
export const GET: RequestHandler = ({ params }) => {
	const schema = /^\d+$/.test(params.version) ? repoConfigJsonSchema(Number(params.version)) : null;
	if (!schema) error(404, 'Unknown schema version');
	// A version never changes once published.
	return json(schema, {
		headers: { 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' }
	});
};
