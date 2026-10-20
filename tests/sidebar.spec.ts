import { test, expect, type Page } from '@playwright/test';

async function setupDirectory(page: Page, nested = false) {
	await page.addInitScript((nested) => {
		// Real, cloneable browser handles exercise IndexedDB persistence across reloads.
		Object.defineProperty(window, 'showDirectoryPicker', {
			value: async () => {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle('comics', { create: true });
				for (const name of nested ? ['album', 'series/volume', 'series'] : ['album', 'other']) {
					let album = directory;
					for (const part of name.split('/')) {
						album = await album.getDirectoryHandle(part, { create: true });
					}
					const file = await album.getFileHandle('01.png', { create: true });
					const writer = await file.createWritable();
					const canvas = document.createElement('canvas');
					canvas.width = 800;
					canvas.height = 1000;
					const image = await new Promise<Blob>((resolve) =>
						canvas.toBlob((blob) => resolve(blob!))
					);
					await writer.write(image);
					await writer.close();
				}
				if (nested) await directory.getDirectoryHandle('empty', { create: true });
				return directory;
			}
		});
		FileSystemHandle.prototype.queryPermission = async () =>
			localStorage.getItem('requirePermission') ? 'prompt' : 'granted';
		FileSystemHandle.prototype.requestPermission = async () => {
			localStorage.removeItem('requirePermission');
			return 'granted';
		};
	}, nested);
	const response = await page.goto('./');
	expect(response?.status()).toBe(200);
	await page.getByRole('button', { name: 'Select directory...' }).click();
}

test('distinguish albums from collections while keeping pages selectable', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setupDirectory(page, true);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const series = page.getByRole('treeitem', { name: 'series/', exact: true });
	await expect(album.locator(':scope > div [data-comic-icon="album"]')).toBeVisible();
	await expect(series.locator(':scope > div [data-comic-icon="collection"]')).toBeVisible();
	await expect(
		page
			.getByRole('treeitem', { name: 'empty/', exact: true })
			.locator('[data-comic-icon="collection"]')
	).toBeVisible();
	await series.press('ArrowRight');
	const volume = page.getByRole('treeitem', { name: 'volume', exact: true });
	await expect(volume.locator(':scope > div [data-comic-icon="album"]')).toBeVisible();
	await volume.press('ArrowRight');
	const comicPage = volume.getByRole('treeitem', { name: '01', exact: true });
	await expect(comicPage.locator('[data-comic-icon="page"]')).toBeVisible();
	await comicPage.click();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await expect(page.locator('[data-comic-icon="album"]')).toHaveCount(2);
	expect(errors).toEqual([]);
});

async function expectSavedFolders(page: Page, folders: string[]) {
	await expect
		.poll(() =>
			page.evaluate(async () => {
				return await new Promise<string[]>((resolve, reject) => {
					const open = indexedDB.open('comix-sense', 1);
					open.onerror = () => reject(open.error);
					open.onsuccess = () => {
						const db = open.result;
						const request = db.transaction('sidebar').objectStore('sidebar').get('session');
						request.onsuccess = () => {
							resolve(request.result?.expandedIds);
							db.close();
						};
					};
				});
			})
		)
		.toEqual(folders);
}

test('restore the directory and multiple expanded folders on startup', async ({ page }) => {
	await setupDirectory(page);
	for (const name of ['album', 'other']) {
		await page.getByRole('treeitem', { name, exact: true }).press('ArrowRight');
	}
	await expectSavedFolders(page, ['album/', 'other/']);
	await page.reload();
	await expect(page.getByRole('treeitem', { name: '01', exact: true })).toHaveCount(2);
	for (const name of ['album', 'other']) {
		await expect(page.getByRole('treeitem', { name, exact: true })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	}
	await page.getByRole('treeitem', { name: '01', exact: true }).first().click();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await page.getByRole('treeitem', { name: 'album', exact: true }).press('ArrowLeft');
	await expectSavedFolders(page, ['other/']);
	await page.reload();
	await expect(page.getByRole('treeitem', { name: 'album', exact: true })).toHaveAttribute(
		'aria-expanded',
		'false'
	);
	await expect(page.getByRole('treeitem', { name: 'other', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
});

test('reopen the saved directory when browser permission must be renewed', async ({ page }) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'album', exact: true }).press('ArrowRight');
	await expectSavedFolders(page, ['album/']);
	await page.evaluate(() => localStorage.setItem('requirePermission', 'true'));
	await page.reload();
	await page.getByRole('button', { name: 'Reopen comics', exact: true }).click();
	await expect(page.getByRole('treeitem', { name: 'album', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await expect(page.getByRole('treeitem', { name: '01', exact: true })).toBeVisible();
});
