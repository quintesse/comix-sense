import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// Include lazy worker and page dependencies before the first browser request.
	// Discovering them during extraction reloads pages and abandons active work.
	optimizeDeps: {
		include: [
			'@zip.js/zip.js/index-native.js',
			'@fortawesome/free-solid-svg-icons',
			'carbon-components-svelte'
		]
	},
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter(),
			paths: {
				base: process.env.NODE_ENV === 'development' ? '' : '/comix-sense'
			}
		})
	]
});
