import { json } from '@sveltejs/kit';
import { repoConfigJsonSchema } from '@hans/config';
import type { RequestHandler } from './$types';

/** The latest JSON Schema for `.hansi.json`. Config files should point at a version instead. */
export const GET: RequestHandler = () =>
	json(repoConfigJsonSchema(), {
		headers: { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' }
	});
