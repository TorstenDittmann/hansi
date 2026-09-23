import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
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
			// One .env at the repository root is shared by web, worker, and drizzle-kit.
			env: { dir: '../..' }
		})
	],
	ssr: {
		// libSQL loads a platform-specific native binary at runtime; bundling breaks that lookup.
		external: ['@libsql/client']
	}
});
