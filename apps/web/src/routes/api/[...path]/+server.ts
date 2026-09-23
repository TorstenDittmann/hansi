import { api } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const fallback: RequestHandler = ({ request }) => api.fetch(request);
