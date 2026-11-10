import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('synthetic pilot overlays open through production directory discovery and language selection', async ({
	page
}) => {
	test.setTimeout(60000);
	const parent = resolve('comics/vision-pilot');
	mkdirSync(parent, { recursive: true });
	const rehearsal = JSON.parse(
		execFileSync(
			process.execPath,
			['--import', './tools/merge-eval/register.mjs', 'tools/vision-pilot/demo.mjs', parent],
			{ encoding: 'utf8' }
		)
	) as { success: string };
	await page.goto('/');
	for (const method of ['baseline', 'vision']) {
		const album = resolve(rehearsal.success, 'overlays', method);
		const files = readdirSync(album).map((name) => ({
			name,
			bytes: [...readFileSync(resolve(album, name))]
		}));
		const opened = await page.evaluate(
			async ({ files, method }) => {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle('pilot-' + method, { create: true });
				for (const { name, bytes } of files) {
					const handle = await directory.getFileHandle(name, { create: true });
					const writer = await handle.createWritable();
					await writer.write(new Uint8Array(bytes));
					await writer.close();
				}
				const modulePath = '/src/lib/types/ComicStore.ts';
				const { DirectoryComicStore } = await import(/* @vite-ignore */ modulePath);
				const store = new DirectoryComicStore(directory);
				try {
					const comics = await store.list();
					const pages = comics.filter((comic: { kind: string }) => comic.kind === 'page');
					return await Promise.all(
						pages.map(async (comic: any) => ({
							path: comic.path,
							languages: comic.languages,
							texts: (await comic.getBubbles('es')).map((b: any) => b.text)
						}))
					);
				} finally {
					store.dispose();
				}
			},
			{ files, method }
		);
		expect(opened).toHaveLength(1);
		expect(opened[0].path).toBe('invented.png');
		expect(opened[0].languages).toContain('es');
		expect(opened[0].texts[0]).toBe('¡Hola, amigo!');
		if (method === 'vision') expect(opened[0].texts).toHaveLength(1);
	}
});
