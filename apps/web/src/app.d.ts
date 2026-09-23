// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session, User } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			user: User | null;
			session: Session | null;
		}
	}
}

export {};
