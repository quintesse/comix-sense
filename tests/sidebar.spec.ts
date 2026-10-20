import { test, expect, type Page } from '@playwright/test';

async function setupDirectory(page: Page) {
	await page.addInitScript(() => {
		// Real, cloneable browser handles exercise IndexedDB persistence across reloads.
		Object.defineProperty(window, 'showDirectoryPicker', {
			value: async () => {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle('comics', { create: true });
				for (const name of ['album', 'other']) {
					const album = await directory.getDirectoryHandle(name, { create: true });
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
				return directory;
			}
		});
		FileSystemHandle.prototype.queryPermission = async () =>
			localStorage.getItem('requirePermission') ? 'prompt' : 'granted';
		FileSystemHandle.prototype.requestPermission = async () => {
			localStorage.removeItem('requirePermission');
			return 'granted';
		};
	});
	await page.goto('./');
	await page.getByRole('button', { name: 'Select directory...' }).click();
}

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
	for (const name of ['album/', 'other/']) {
		await page.getByRole('treeitem', { name, exact: true }).press('ArrowRight');
	}
	await expectSavedFolders(page, ['album/', 'other/']);
	await page.reload();
	await expect(page.getByRole('treeitem', { name: '01', exact: true })).toHaveCount(2);
	for (const name of ['album/', 'other/']) {
		await expect(page.getByRole('treeitem', { name, exact: true })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	}
	await page.getByRole('treeitem', { name: '01', exact: true }).first().click();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await page.getByRole('treeitem', { name: 'album/', exact: true }).press('ArrowLeft');
	await expectSavedFolders(page, ['other/']);
	await page.reload();
	await expect(page.getByRole('treeitem', { name: 'album/', exact: true })).toHaveAttribute(
		'aria-expanded',
		'false'
	);
	await expect(page.getByRole('treeitem', { name: 'other/', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
});

test('reopen the saved directory when browser permission must be renewed', async ({ page }) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'album/', exact: true }).press('ArrowRight');
	await expectSavedFolders(page, ['album/']);
	await page.evaluate(() => localStorage.setItem('requirePermission', 'true'));
	await page.reload();
	await page.getByRole('button', { name: 'Reopen comics', exact: true }).click();
	await expect(page.getByRole('treeitem', { name: 'album/', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await expect(page.getByRole('treeitem', { name: '01', exact: true })).toBeVisible();
});
