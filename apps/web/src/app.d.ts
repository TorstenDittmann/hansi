// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session, User } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			user: User | null;
			session: Session | null;
		}
		interface PageData {
			/** Document and Open Graph title. Pages return this from `load` to override the default. */
			title?: string;
			/** Meta and Open Graph description. Pages return this from `load` to override the default. */
			description?: string;
			/** Set on `/app` pages. The organization in the URL, or the active one on account pages. */
			organization?: { id: string; name: string; slug: string };
			organizations?: { id: string; name: string; slug: string }[];
			appSlug?: string | null;
		}
	}
}

export {};
