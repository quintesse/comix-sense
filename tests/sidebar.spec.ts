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
					const second = await album.getFileHandle('02.png', { create: true });
					const secondWriter = await second.createWritable();
					await secondWriter.write(image);
					await secondWriter.close();
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

async function savedHistory(page: Page) {
	return page.evaluate(async () => {
		return await new Promise<{ lastPage?: string; albumPages: Record<string, string> }[]>(
			(resolve, reject) => {
				const open = indexedDB.open('comix-sense', 1);
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					const request = db.transaction('sidebar').objectStore('sidebar').get('readingHistory');
					request.onsuccess = () => {
						resolve(request.result ?? []);
						db.close();
					};
				};
			}
		);
	});
}

test('restore the last page on startup and after delayed permission renewal', async ({ page }) => {
	await setupDirectory(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.press('ArrowRight');
	await album.getByRole('treeitem', { name: '02', exact: true }).click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await expect(album.getByRole('treeitem', { name: '02', exact: true })).toHaveClass(/--active/);
	await page.evaluate(() => localStorage.setItem('requirePermission', 'true'));
	await page.reload();
	await expect(page.getByRole('button', { name: 'Reopen comics', exact: true })).toBeVisible();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await page.getByRole('button', { name: 'Reopen comics', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await expect(album.getByRole('treeitem', { name: '02', exact: true })).toHaveClass(/--active/);
});

test('album clicks open the first page or its browser-saved reading position', async ({ page }) => {
	await setupDirectory(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const other = page.getByRole('treeitem', { name: 'other', exact: true });
	await album.getByText('album', { exact: true }).click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/01.png');
	await album.press('ArrowRight');
	await album.getByRole('treeitem', { name: '02', exact: true }).click();
	await other.click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('other/01.png');
	expect((await savedHistory(page))[0]?.albumPages).toEqual({
		'album/': 'album/02.png',
		'other/': 'other/01.png'
	});
	await page.reload();
	await album.getByText('album', { exact: true }).click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
});

test('missing saved pages are silently retained and restored when available again', async ({
	page
}) => {
	await setupDirectory(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.press('ArrowRight');
	await album.getByRole('treeitem', { name: '02', exact: true }).click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const comics = await root.getDirectoryHandle('comics');
		const album = await comics.getDirectoryHandle('album');
		const file = await (await album.getFileHandle('02.png')).getFile();
		const backup = await album.getFileHandle('backup.png', { create: true });
		const writer = await backup.createWritable();
		await writer.write(file);
		await writer.close();
		await album.removeEntry('02.png');
	});
	await page.reload();
	await expect(album).toBeVisible();
	await expect(page.getByRole('img', { name: 'Comic page' })).toHaveCount(0);
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect((await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const comics = await root.getDirectoryHandle('comics');
		const album = await comics.getDirectoryHandle('album');
		const file = await (await album.getFileHandle('backup.png')).getFile();
		const restored = await album.getFileHandle('02.png', { create: true });
		const writer = await restored.createWritable();
		await writer.write(file);
		await writer.close();
	});
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await expect(album.getByRole('treeitem', { name: '02', exact: true })).toHaveClass(/--active/);
});
