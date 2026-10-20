import { defineConfig } from '@playwright/test';

const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';

export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	workers: process.env.CI ? 2 : undefined,
	use: {
		baseURL,
		channel:
			process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
		viewport: { width: 1440, height: 1100 },
		trace: 'retain-on-failure'
	},
	webServer: process.env.TEST_BASE_URL
		? undefined
		: {
				command: 'node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5173 --strictPort',
				url: baseURL,
				reuseExistingServer: !process.env.CI
			}
});
