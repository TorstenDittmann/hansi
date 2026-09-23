import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

// One .env at the repository root is shared by web, worker, and drizzle-kit.
const envDir = '../..';

export default defineConfig(({ command, mode }) => {
	// In development GitHub reaches the dev server through a tunnel (APP_URL). Vite must accept
	// that host, and SvelteKit's CSRF check must accept form posts from the tunnel's https origin,
	// since the dev server itself only sees plain http. Production uses ORIGIN instead.
	const appUrl = command === 'serve' ? loadEnv(mode, envDir, '').APP_URL : undefined;
	const tunnel = appUrl && !/^https?:\/\/localhost[:/]/.test(appUrl) ? new URL(appUrl) : null;

	return {
		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				// adapter-node output runs under Bun in production (`bun build/index.js`).
				adapter: adapter({ out: 'build' }),
				env: { dir: envDir },
				csrf: { trustedOrigins: tunnel ? [tunnel.origin] : [] }
			})
		],
		server: { allowedHosts: tunnel ? [tunnel.hostname] : [] },
		ssr: {
			// libSQL loads a platform-specific native binary at runtime; bundling breaks that lookup.
			external: ['@libsql/client']
		}
	};
});
