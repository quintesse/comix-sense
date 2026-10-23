import { test, expect, type Page } from '@playwright/test';
import {
	sharedFilenamePrefix,
	withoutParentPrefix,
	withoutAlbumPrefix
} from '../src/lib/types/funcs';

async function setupDirectory(
	page: Page,
	nested = false,
	translations = false,
	iconLanguages = false
) {
	await page.addInitScript(
		({ nested, translations, iconLanguages }) => {
			Object.defineProperty(navigator, 'languages', { value: ['fr-FR', 'en-GB', 'nl-NL'] });
			// Real, cloneable browser handles exercise IndexedDB persistence across reloads.
			Object.defineProperty(window, 'showDirectoryPicker', {
				value: async () => {
					// Capture the requested root when the picker opens, before async fixture creation.
					const parentName = localStorage.getItem('pickerParent');
					const root = await navigator.storage.getDirectory();
					const parent = parentName
						? await root.getDirectoryHandle(parentName, { create: true })
						: root;
					const directory = await parent.getDirectoryHandle('comics', { create: true });
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
						if (iconLanguages && name === 'album') {
							const rendered = await album.getFileHandle('02.en.webp', { create: true });
							const renderedWriter = await rendered.createWritable();
							await renderedWriter.write(
								await new Promise<Blob>((resolve) =>
									canvas.toBlob((blob) => resolve(blob!), 'image/webp')
								)
							);
							await renderedWriter.close();
						}
						if (translations) {
							for (const language of name === 'album'
								? ['en', 'nl', ...(iconLanguages ? ['ocr', 'zz'] : [])]
								: ['nl']) {
								const translation = await album.getFileHandle(`01.${language}.bbl`, {
									create: true
								});
								const writer = await translation.createWritable();
								await writer.write(JSON.stringify({ pages: [{ bubbles: [] }] }));
								await writer.close();
							}
						}
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
		},
		{ nested, translations, iconLanguages }
	);
	const response = await page.goto('./');
	expect(response?.status()).toBe(200);
	await page.getByRole('button', { name: 'Add folder' }).click();
	// Clicking starts an async picker. Wait before a test changes pickerParent
	// or opens another root, otherwise both calls can select the second root.
	await expect(page.getByRole('treeitem', { name: 'comics/', exact: true })).toHaveCount(1);
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
	const comicPage = volume.getByRole('treeitem', { name: /^0?1$/, exact: true });
	await expect(comicPage.locator('[data-comic-icon="page"]')).toBeVisible();
	await comicPage.click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
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
							const session = request.result;
							const rootId = session?.directories?.[0]?.id;
							resolve(
								session?.expandedIds
									.filter((id: string) => id !== rootId)
									.map((id: string) => (rootId ? id.slice(rootId.length + 1) : id))
							);
							db.close();
						};
					};
				});
			})
		)
		.toEqual(folders);
}

test('album page pane follows navigation, scrolls selection into view and navigates on click', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 720 });
	// setViewportSize also resizes the emulated screen; this is a normal window.
	await page.addInitScript(() => Object.defineProperty(window, 'fullScreen', { value: false }));
	await setupDirectory(page);
	const pane = page.getByRole('region', { name: 'Album pages' });
	await expect(pane).toContainText('Select an album');
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.press('ArrowRight');
	await album.click();
	const first = pane.getByRole('button', { name: /^0?1$/, exact: true });
	const second = pane.getByRole('button', { name: /^0?2$/, exact: true });
	await expect(pane.getByRole('button')).toHaveCount(2);
	await expect(first).toHaveAttribute('aria-current', 'page');
	await expect
		.poll(() => first.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBe(800);

	const treeBounds = await page.locator('.tree').boundingBox();
	const paneBounds = await pane.boundingBox();
	expect(treeBounds).not.toBeNull();
	expect(paneBounds).not.toBeNull();
	expect(Math.abs(treeBounds!.height - paneBounds!.height)).toBeLessThan(2);
	expect(paneBounds!.y).toBeCloseTo(treeBounds!.y + treeBounds!.height + 6, 0);

	await page.keyboard.press('Shift+PageDown');
	await expect(second).toHaveAttribute('aria-current', 'page');
	await expect(first).not.toHaveAttribute('aria-current');
	await expect(album.getByRole('treeitem', { name: /^0?2$/, exact: true })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/02.png'
	);
	await expect.poll(() => pane.locator('ul').evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
	const secondBounds = await second.boundingBox();
	expect(secondBounds!.y + secondBounds!.height).toBeLessThanOrEqual(
		paneBounds!.y + paneBounds!.height + 1
	);

	await first.click();
	await expect(first).toHaveAttribute('aria-current', 'page');
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/01.png'
	);
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/01.png');
	await first.press('ArrowDown');
	await expect(second).toBeFocused();
	await expect(first).toHaveAttribute('aria-current', 'page');
	await second.press('Enter');
	await expect(second).toBeFocused();
	await expect(second).toHaveAttribute('aria-current', 'page');
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/02.png'
	);
	await second.press('ArrowUp');
	await expect(first).toBeFocused();
	await expect(second).toHaveAttribute('aria-current', 'page');
	await first.press('Enter');
	await expect(first).toHaveAttribute('aria-current', 'page');
	await first.press('End');
	await expect(second).toBeFocused();
	await second.press('Home');
	await expect(first).toBeFocused();
	await page.reload();
	await expect(pane.getByRole('button', { name: /^0?1$/, exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('sidebar dividers resize the panes and reader with pointer and keyboard controls', async ({
	page
}) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'album', exact: true }).click();
	const horizontal = page.getByRole('separator', { name: 'Resize sidebar panes', exact: true });
	const vertical = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
	const tree = page.locator('.tree');
	const pages = page.getByRole('region', { name: 'Album pages' });
	const beforeTree = (await tree.boundingBox())!;
	const beforePages = (await pages.boundingBox())!;
	const split = (await horizontal.boundingBox())!;
	await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
	await page.mouse.down();
	await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2 + 100, { steps: 5 });
	await page.mouse.up();
	expect((await tree.boundingBox())!.height).toBeCloseTo(beforeTree.height + 100, 0);
	expect((await pages.boundingBox())!.height).toBeCloseTo(beforePages.height - 100, 0);
	await horizontal.press('Home');
	await expect(horizontal).toHaveAttribute('aria-valuenow', '15');
	await horizontal.press('End');
	await expect(horizontal).toHaveAttribute('aria-valuenow', '85');
	await horizontal.press('ArrowUp');
	await expect(horizontal).toHaveAttribute('aria-valuenow', '83');
	await horizontal.dblclick();
	await expect(horizontal).toHaveAttribute('aria-valuenow', '50');

	const beforeMain = (await page.locator('main').boundingBox())!;
	const edge = (await vertical.boundingBox())!;
	await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 100, edge.y + edge.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect(vertical).toHaveAttribute('aria-valuenow', '356');
	await expect.poll(async () => (await tree.boundingBox())!.width).toBe(356);
	await expect
		.poll(async () => (await page.locator('main').boundingBox())!.x)
		.toBe(beforeMain.x + 100);
	await expect
		.poll(async () => (await page.locator('main').boundingBox())!.width)
		.toBe(beforeMain.width - 100);
	await vertical.press('ArrowLeft');
	await expect(vertical).toHaveAttribute('aria-valuenow', '340');
	await vertical.press('Home');
	await expect(vertical).toHaveAttribute('aria-valuenow', '200');
	await vertical.press('End');
	await expect(vertical).toHaveAttribute('aria-valuenow', '480');
	await vertical.dblclick();
	await expect(vertical).toHaveAttribute('aria-valuenow', '256');
	await pages.getByRole('button', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/02.png'
	);
});

test('page pane switches albums and excludes pages in nested albums', async ({ page }) => {
	await setupDirectory(page, true);
	const pane = page.getByRole('region', { name: 'Album pages' });
	await page.getByRole('treeitem', { name: 'album', exact: true }).click();
	await pane.getByRole('button', { name: /^0?2$/, exact: true }).click();
	const oldPreview = await pane.locator('img').first().getAttribute('src');
	const series = page.getByRole('treeitem', { name: 'series/', exact: true });
	await series.press('ArrowRight');
	await series.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect(pane.getByRole('button')).toHaveCount(2);
	await expect(pane.locator('button').first()).toHaveAttribute('data-page', 'series/01.png');
	await page.getByRole('treeitem', { name: 'volume', exact: true }).click();
	await expect(pane.getByRole('button')).toHaveCount(2);
	await expect(pane.locator('button').first()).toHaveAttribute('data-page', 'series/volume/01.png');
	if (oldPreview) {
		expect(
			await page.evaluate(async (url) => {
				try {
					await fetch(url);
					return false;
				} catch {
					return true;
				}
			}, oldPreview)
		).toBe(true);
	}
	await page.getByRole('treeitem', { name: 'album', exact: true }).click();
	await expect(pane.getByRole('button', { name: /^0?2$/, exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('Enter selects without toggling expansion or moving focus out of the tree', async ({
	page
}) => {
	await setupDirectory(page, true);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.press('Enter');
	await expect(album).toHaveAttribute('aria-expanded', 'false');
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/01.png');
	await expect(album).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(album).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Enter');
	await expect(album).toHaveAttribute('aria-expanded', 'true');
	await expect(album).toBeFocused();
	const second = album.getByRole('treeitem', { name: /^0?2$/, exact: true });
	await second.press('Enter');
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await expect(second).toBeFocused();
	const series = page.getByRole('treeitem', { name: 'series/', exact: true });
	await series.press('Enter');
	await expect(series).toBeFocused();
	await expect(series).toHaveAttribute('aria-expanded', 'false');
});

test('Locate reveals the current page through collapsed ancestors with button and shortcut', async ({
	page
}) => {
	await page.setViewportSize({ width: 1440, height: 720 });
	await page.addInitScript(() => Object.defineProperty(window, 'fullScreen', { value: false }));
	await setupDirectory(page, true);
	const locate = page.getByRole('button', { name: 'Locate', exact: true });
	await expect(locate).toBeDisabled();
	await expect(locate).toHaveAttribute('aria-keyshortcuts', 'l');
	await expect(locate).toHaveAttribute('title', 'Locate Page (L)');
	await expect(locate.locator('[data-toolbar-icon="crosshairs"]')).toBeVisible();
	const root = page.getByRole('treeitem', { name: 'comics/', exact: true });
	const series = page.getByRole('treeitem', { name: 'series/', exact: true });
	await series.press('ArrowRight');
	const volume = series.getByRole('treeitem', { name: 'volume', exact: true });
	await volume.press('Enter');
	await expect(locate).toBeEnabled();
	const pageList = page.getByRole('region', { name: 'Album pages' });
	const currentThumbnail = pageList.locator('button[aria-current="page"]');
	await pageList.locator('ul').evaluate((list) => (list.scrollTop = list.scrollHeight));
	await expect(currentThumbnail).not.toBeInViewport({ ratio: 1 });
	await root.press('ArrowLeft');
	await locate.click();
	await expect(currentThumbnail).toHaveAttribute('data-page', 'series/volume/01.png');
	await expect(currentThumbnail).toBeInViewport({ ratio: 1 });
	const first = volume.getByRole('treeitem', { name: /^0?1$/, exact: true });
	await expect(root).toHaveAttribute('aria-expanded', 'true');
	await expect(volume).toHaveAttribute('aria-expanded', 'true');
	await expect(first).toBeVisible();
	await expect(first).toBeFocused();
	await expect(first).toHaveAttribute('aria-current', 'true');
	await expect(first).toHaveAttribute('aria-selected', 'true');
	await series.press('ArrowLeft');
	await root.press('ArrowLeft');
	await pageList.locator('ul').evaluate((list) => (list.scrollTop = list.scrollHeight));
	await expect(currentThumbnail).not.toBeInViewport({ ratio: 1 });
	await root.press('l');
	await expect(currentThumbnail).toBeInViewport({ ratio: 1 });
	await expect(series).toHaveAttribute('aria-expanded', 'true');
	await expect(first).toBeVisible();
	await expect(first).toBeFocused();
	await expect
		.poll(async () => (await savedHistory(page))[0]?.lastPage)
		.toBe('series/volume/01.png');
});

test('mouse selections keep focus in the tree', async ({ page }) => {
	await setupDirectory(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.click();
	await expect(album).toBeFocused();
	await album.click();
	await expect(album).toBeFocused();
	await album.press('ArrowRight');
	const first = album.getByRole('treeitem', { name: /^0?1$/, exact: true });
	await first.click();
	await expect(first).toBeFocused();
	await first.click();
	await expect(first).toBeFocused();
});

test('restore the directory and multiple expanded folders on startup', async ({ page }) => {
	await setupDirectory(page);
	for (const name of ['album', 'other']) {
		await page.getByRole('treeitem', { name, exact: true }).press('ArrowRight');
	}
	await expectSavedFolders(page, ['album/', 'other/']);
	await page.reload();
	await expect(page.getByRole('treeitem', { name: /^0?1$/, exact: true })).toHaveCount(2);
	for (const name of ['album', 'other']) {
		await expect(page.getByRole('treeitem', { name, exact: true })).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	}
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).first().click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
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
	await expect(page.getByRole('treeitem', { name: /^0?1$/, exact: true })).toBeVisible();
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

async function chooseLanguage(page: Page, current: string, language: string) {
	await page.getByRole('menuitem', { name: current, exact: true }).click();
	await page
		.getByRole('menu', { name: current, exact: true })
		.getByText(
			({ EN: 'English (EN)', NL: 'Dutch (NL)' } as Record<string, string>)[language] ?? language,
			{ exact: true }
		)
		.click();
	await page.getByRole('menuitem', { name: language, exact: true }).click();
}

test('tree page icons use images in reading mode and images or BBL in edit mode', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await setupDirectory(page, false, true, true);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const other = page.getByRole('treeitem', { name: 'other', exact: true });
	await album.press('ArrowRight');
	await other.press('ArrowRight');
	await album.click();
	const first = album.getByRole('treeitem', { name: /^0?1$/, exact: true });
	const second = album.getByRole('treeitem', { name: /^0?2$/, exact: true });
	const otherFirst = other.getByRole('treeitem', { name: /^0?1$/, exact: true });
	const flag = first.locator('.page-icon img');
	// EN exists only as BBL on the first page and only as an image on the second.
	await expect(first.locator('[data-comic-icon="page"]')).toBeVisible();
	await expect(flag).toHaveCount(0);
	await expect(second.locator('.page-icon img')).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(flag).toHaveAttribute(
		'src',
		(await page
			.getByRole('menuitem', { name: 'EN', exact: true })
			.locator('img')
			.getAttribute('src'))!
	);
	await expect(second.locator('.page-icon img')).toBeVisible();
	await expect(otherFirst.locator('[data-comic-icon="page"]')).toBeVisible();
	await second.click();

	async function select(current: string, next: string) {
		await page.getByRole('menuitem', { name: current, exact: true }).click();
		await page
			.getByRole('menuitemradio', {
				name:
					({ EN: 'English (EN)', NL: 'Dutch (NL)', ES: 'Spanish (ES)' } as Record<string, string>)[
						next
					] ?? next,
				exact: true
			})
			.click();
		await expect(second).toHaveAttribute('aria-current', 'true');
		await expect(album).toHaveAttribute('aria-expanded', 'true');
		await expect(other).toHaveAttribute('aria-expanded', 'true');
	}
	await select('EN', 'NL');
	const dutchFlag = (await page
		.getByRole('menuitem', { name: 'NL', exact: true })
		.locator('img')
		.getAttribute('src'))!;
	await expect(flag).toHaveAttribute('src', dutchFlag);
	await expect(otherFirst.locator('.page-icon img')).toHaveAttribute('src', dutchFlag);
	await page.getByRole('button', { name: 'Reading Mode', exact: true }).click();
	await expect(page.locator('.comic-tree .page-icon img')).toHaveCount(0);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(flag).toHaveAttribute('src', dutchFlag);
	await expect(otherFirst.locator('.page-icon img')).toHaveAttribute('src', dutchFlag);
	await expect(second.locator('[data-comic-icon="page"]')).toBeVisible();
	await select('NL', 'OCR');
	await expect(first.locator('[data-toolbar-icon="video"]')).toBeVisible();
	await page.getByRole('button', { name: 'Reading Mode', exact: true }).click();
	await expect(first.locator('[data-toolbar-icon="video"]')).toHaveCount(0);
	await expect(first.locator('[data-comic-icon="page"]')).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(first.locator('[data-toolbar-icon="video"]')).toBeVisible();
	await expect(second.locator('[data-comic-icon="page"]')).toBeVisible();
	await expect(otherFirst.locator('[data-comic-icon="page"]')).toBeVisible();
	await expect(first.locator('.page-icon img')).toHaveCount(0);
	await select('OCR', 'ZZ');
	await expect(first.locator('[data-comic-icon="page"]')).toBeVisible();
	await expect(first.locator('[data-toolbar-icon="video"]')).toHaveCount(0);
	await select('ZZ', 'EN');
	await expect(flag).toHaveAttribute(
		'src',
		(await page
			.getByRole('menuitem', { name: 'EN', exact: true })
			.locator('img')
			.getAttribute('src'))!
	);
	await select('EN', 'ORG');
	await expect(page.locator('.comic-tree .page-icon img')).toHaveCount(0);
	await expect(page.locator('.comic-tree [data-comic-icon="page"]')).toHaveCount(4);
	await expect(page.locator('.comic-tree [data-comic-icon="album"]')).toHaveCount(2);
	expect(errors).toEqual([]);
});

test('remember explicit language choices per album including ORG across reloads', async ({
	page
}) => {
	await setupDirectory(page, false, true);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const other = page.getByRole('treeitem', { name: 'other', exact: true });
	await album.click();
	await expect(page.getByRole('menuitem', { name: 'EN', exact: true })).toBeVisible();
	await chooseLanguage(page, 'EN', 'ORG');
	await other.click();
	await expect(page.getByRole('menuitem', { name: 'NL', exact: true })).toBeVisible();
	await chooseLanguage(page, 'NL', 'ORG');
	await album.click();
	await expect(page.getByRole('menuitem', { name: 'ORG', exact: true })).toBeVisible();
	await chooseLanguage(page, 'ORG', 'NL');
	await expect
		.poll(async () => (await savedHistory(page))[0])
		.toMatchObject({
			albumLanguages: { 'album/': 'nl', 'other/': 'org' }
		});
	await page.reload();
	await expect(page.getByRole('menuitem', { name: 'NL', exact: true })).toBeVisible();
	await other.click();
	await expect(page.getByRole('menuitem', { name: 'ORG', exact: true })).toBeVisible();
});

test('unavailable saved language falls back to browser preferences then ORG', async ({ page }) => {
	await setupDirectory(page, false, true);
	await page.getByRole('treeitem', { name: 'album', exact: true }).click();
	await chooseLanguage(page, 'EN', 'NL');
	await expect
		.poll(async () => (await savedHistory(page))[0])
		.toMatchObject({
			albumLanguages: { 'album/': 'nl' }
		});
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const comics = await root.getDirectoryHandle('comics');
		const album = await comics.getDirectoryHandle('album');
		await album.removeEntry('01.nl.bbl');
	});
	await page.reload();
	await expect(page.getByRole('menuitem', { name: 'EN', exact: true })).toBeVisible();
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const comics = await root.getDirectoryHandle('comics');
		const album = await comics.getDirectoryHandle('album');
		await album.removeEntry('01.en.bbl');
	});
	await page.reload();
	await expect(page.getByRole('menuitem', { name: 'ORG', exact: true })).toBeVisible();
	// Automatic fallbacks must not replace the user's original choice.
	expect((await savedHistory(page))[0]).toMatchObject({ albumLanguages: { 'album/': 'nl' } });
});

test('restore the last page on startup and after delayed permission renewal', async ({ page }) => {
	await setupDirectory(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.press('ArrowRight');
	await album.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await expect(album.getByRole('treeitem', { name: /^0?2$/, exact: true })).toHaveClass(/--active/);
	await page.evaluate(() => localStorage.setItem('requirePermission', 'true'));
	await page.reload();
	await expect(page.getByRole('button', { name: 'Reopen comics', exact: true })).toBeVisible();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await page.getByRole('button', { name: 'Reopen comics', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await expect(album.getByRole('treeitem', { name: /^0?2$/, exact: true })).toHaveClass(/--active/);
});

test('album clicks open the first page or its browser-saved reading position', async ({ page }) => {
	await setupDirectory(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const other = page.getByRole('treeitem', { name: 'other', exact: true });
	await album.getByText('album', { exact: true }).click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/01.png');
	await album.press('ArrowRight');
	await album.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await other.click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('other/01.png');
	expect((await savedHistory(page))[0]?.albumPages).toEqual({
		'album/': 'album/02.png',
		'other/': 'other/01.png'
	});
	await page.reload();
	await album.getByText('album', { exact: true }).click();
	await expect.poll(async () => (await savedHistory(page))[0]?.lastPage).toBe('album/02.png');
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
});

test('missing saved pages are silently retained and restored when available again', async ({
	page
}) => {
	await setupDirectory(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.press('ArrowRight');
	await album.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
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
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await expect(album.getByRole('treeitem', { name: /^0?2$/, exact: true })).toHaveClass(/--active/);
});

test('add independent folder roots, avoid duplicates and restore all roots and reading positions', async ({
	page
}) => {
	await setupDirectory(page);
	const roots = page.getByRole('treeitem', { name: 'comics/', exact: true });
	await expect(roots).toHaveCount(1);
	await expect(roots.first()).not.toHaveAttribute('title');
	const firstAlbum = roots.first().getByRole('treeitem', { name: 'album', exact: true });
	await firstAlbum.press('ArrowRight');
	await firstAlbum.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	const add = page.getByRole('button', { name: 'Add folder', exact: true });
	const bounds = (await page.locator('.tree').boundingBox())!;
	const buttonBounds = (await add.boundingBox())!;
	expect(bounds.x + bounds.width - buttonBounds.x - buttonBounds.width).toBeCloseTo(16, 0);
	expect(bounds.y + bounds.height - buttonBounds.y - buttonBounds.height).toBeCloseTo(16, 0);
	await add.click();
	await expect(roots).toHaveCount(1);
	await page.evaluate(() => localStorage.setItem('pickerParent', 'second'));
	await add.click();
	await expect(roots).toHaveCount(2);
	const secondAlbum = roots.nth(1).getByRole('treeitem', { name: 'album', exact: true });
	await secondAlbum.press('ArrowRight');
	await secondAlbum.getByText('album', { exact: true }).click();
	await expect(
		page
			.getByRole('region', { name: 'Album pages' })
			.getByRole('button', { name: /^0?1$/, exact: true })
	).toHaveAttribute('aria-current', 'page');
	await firstAlbum.getByText('album', { exact: true }).click();
	await expect(
		page
			.getByRole('region', { name: 'Album pages' })
			.getByRole('button', { name: /^0?2$/, exact: true })
	).toHaveAttribute('aria-current', 'page');
	await expect
		.poll(async () => (await savedHistory(page)).map((entry) => entry.lastPage))
		.toEqual(['album/02.png', 'album/01.png']);
	await page.reload();
	await expect(roots).toHaveCount(2);
	await expect(firstAlbum).toHaveAttribute('aria-expanded', 'true');
	await expect(secondAlbum).toHaveAttribute('aria-expanded', 'true');
	await expect(firstAlbum.getByRole('treeitem', { name: /^0?2$/, exact: true })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await secondAlbum.getByText('album', { exact: true }).click();
	await expect(secondAlbum.getByRole('treeitem', { name: /^0?1$/, exact: true })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await expect(
		firstAlbum.getByRole('treeitem', { name: /^0?2$/, exact: true })
	).not.toHaveAttribute('aria-current');
});

test('migrate a single-folder session before renewing directory permission', async ({ page }) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'album', exact: true }).press('ArrowRight');
	await expectSavedFolders(page, ['album/']);
	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			const open = indexedDB.open('comix-sense', 1);
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const db = open.result;
				const transaction = db.transaction('sidebar', 'readwrite');
				const store = transaction.objectStore('sidebar');
				const request = store.get('session');
				request.onsuccess = () =>
					store.put(
						{
							directory: request.result.directories[0].directory,
							expandedIds: ['album/']
						},
						'session'
					);
				transaction.oncomplete = () => {
					db.close();
					resolve();
				};
				transaction.onabort = () => {
					db.close();
					reject(transaction.error);
				};
			};
		});
		localStorage.setItem('requirePermission', 'true');
	});
	await page.reload();
	await page.getByRole('button', { name: 'Reopen comics', exact: true }).click();
	const root = page.getByRole('treeitem', { name: 'comics/', exact: true });
	await expect(root).toHaveAttribute('aria-expanded', 'true');
	await expect(root.getByRole('treeitem', { name: 'album', exact: true })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await expect(root.getByRole('treeitem', { name: /^0?1$/, exact: true })).toBeVisible();
});

test('disconnect appears on root hover and focus; Delete asks before clearing a folder', async ({
	page
}) => {
	await setupDirectory(page);
	const root = page.getByRole('treeitem', { name: 'comics/', exact: true });
	const album = root.getByRole('treeitem', { name: 'album', exact: true });
	await album.click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	const disconnect = root.getByRole('button', { name: 'Disconnect comics', exact: true });
	await page.mouse.move(1000, 500);
	await expect(disconnect).toHaveCSS('opacity', '0');
	await root.getByText('comics/', { exact: true }).hover();
	await expect(disconnect).toHaveCSS('opacity', '1');
	const buttonBounds = (await disconnect.boundingBox())!;
	const treeBounds = (await page.locator('.tree').boundingBox())!;
	expect(buttonBounds.x).toBeGreaterThan(treeBounds.x + treeBounds.width - 60);
	await disconnect.click();
	const dialog = page.getByRole('dialog', { name: 'Remove folder?' });
	await expect(dialog).toContainText('comics');
	await dialog.getByRole('button', { name: 'No', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(root).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.mouse.move(1000, 500);
	await root.focus();
	await expect(disconnect).toHaveCSS('opacity', '1');
	await root.press('Delete');
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).not.toBeVisible();
	await album.press('Delete');
	await expect(dialog).not.toBeVisible();
	await root.press('Delete');
	await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(root).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Album pages' })).toContainText(
		'Add a comics source'
	);
	await expect(page.getByRole('img', { name: 'Comic page' })).toHaveCount(0);
	await expect(page.locator('main')).toContainText('Add a comics source');
	await expect(page.getByRole('button', { name: 'Add folder', exact: true })).toBeFocused();
	await page.reload();
	await expect(root).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Add folder' })).toBeVisible();
});

test('disconnecting another root preserves the current album and reader', async ({ page }) => {
	await setupDirectory(page);
	await page.evaluate(() => localStorage.setItem('pickerParent', 'second'));
	await page.getByRole('button', { name: 'Add folder', exact: true }).click();
	const roots = page.getByRole('treeitem', { name: 'comics/', exact: true });
	await expect(roots).toHaveCount(2);
	await roots.nth(1).getByRole('treeitem', { name: 'album', exact: true }).click();
	const pane = page.getByRole('region', { name: 'Album pages' });
	await pane.getByRole('button', { name: /^0?2$/, exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await roots.first().getByText('comics/', { exact: true }).hover();
	await roots.first().getByRole('button', { name: 'Disconnect comics', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(roots).toHaveCount(1);
	await expect(pane.getByRole('button', { name: /^0?2$/, exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.reload();
	await expect(roots).toHaveCount(1);
	await expect(pane.getByRole('button', { name: /^0?2$/, exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('report malformed archives without hiding adjacent pages', async ({ page }) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'other', exact: true }).press('ArrowRight');
	await expectSavedFolders(page, ['other/']);
	await page.evaluate(async () => {
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('comics');
		for (const name of ['issue.cbz', 'old.CBR', 'pack.zip', 'notes.txt']) {
			await directory.getFileHandle(name, { create: true });
		}
		const album = await directory.getDirectoryHandle('album');
		await album.getFileHandle('bonus.ZIP', { create: true });
		const image = await (await album.getFileHandle('01.png')).getFile();
		const sibling = await directory.getFileHandle('issue.cbz-extra.png', { create: true });
		const writer = await sibling.createWritable();
		await writer.write(image);
		await writer.close();
	});
	await page.reload();
	await page.getByRole('treeitem', { name: 'other', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	const selectedPage = page.locator('[data-page-path]').first();
	await expect(selectedPage).toHaveAttribute('data-page-path', 'other/01.png');
	for (const name of ['issue.cbz', 'old.CBR', 'pack.zip']) {
		const archive = page.getByRole('treeitem', {
			name: name.replace(/\.(cbr|cbz|zip)$/i, ''),
			exact: true
		});
		await expect(archive).toHaveAttribute('aria-disabled', 'false');
		await expect(
			archive.getByText(name.replace(/\.(cbr|cbz|zip)$/i, ''), { exact: true })
		).toHaveAttribute('title', name);
		await expect(archive.locator('[data-comic-icon="album"]')).toBeVisible();
		await expect(archive).toHaveAttribute('aria-expanded', 'false');
		await archive.click({ force: true });
		await expect(page.getByRole('alert')).toContainText('signature');
		await expect(selectedPage).toHaveAttribute('data-page-path', 'other/01.png');
	}
	await expect(page.getByRole('treeitem', { name: 'notes.txt', exact: true })).toHaveCount(0);
	const album = page.getByRole('treeitem', { name: 'album/', exact: true });
	await album.press('ArrowRight');
	await expect(album.getByRole('treeitem', { name: 'bonus', exact: true })).toHaveAttribute(
		'aria-disabled',
		'false'
	);
	const sibling = page.getByRole('treeitem', { name: 'issue.cbz-extra', exact: true });
	await sibling.click();
	await expect(selectedPage).toHaveAttribute('data-page-path', 'issue.cbz-extra.png');
});

test('shorten shared page prefixes in both panes while retaining filenames and navigation', async ({
	page
}) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'album', exact: true }).press('ArrowRight');
	await expectSavedFolders(page, ['album/']);
	await page.evaluate(async () => {
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('comics');
		const album = await directory.getDirectoryHandle('album');
		for (const [oldName, newName] of [
			['01.png', 'Book - 001.png'],
			['02.png', 'Book - 002.png']
		]) {
			const image = await (await album.getFileHandle(oldName)).getFile();
			const writer = await (await album.getFileHandle(newName, { create: true })).createWritable();
			await writer.write(image);
			await writer.close();
			await album.removeEntry(oldName);
		}
	});
	await page.reload();
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const first = album.getByRole('treeitem', { name: '1', exact: true });
	await expect(first.getByText('1', { exact: true })).toHaveAttribute('title', 'Book - 001.png');
	await first.click();
	const pane = page.getByRole('region', { name: 'Album pages' });
	await expect(pane.getByRole('button', { name: '1', exact: true })).toHaveAttribute(
		'title',
		'Book - 001.png'
	);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/Book - 001.png'
	);
	await pane.getByRole('button', { name: '2', exact: true }).click();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/Book - 002.png'
	);
	await expect(album.getByRole('treeitem', { name: '2', exact: true })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await page.getByRole('treeitem', { name: 'other', exact: true }).click();
	await expect(pane.getByRole('button', { name: '1', exact: true })).toBeVisible();
	await expect(pane.getByRole('button', { name: '2', exact: true })).toBeAttached();
});

test('shared prefixes include shared digits and never produce empty labels', () => {
	for (const [names, expected] of [
		[['Book - 001', 'Book - 002'], 'Book - 00'],
		[['Book001', 'Book002'], 'Book00'],
		[['001', '002'], '00'],
		[['Only page'], ''],
		[['Book', 'Book extra'], ''],
		[['Book', 'Book'], ''],
		[['Alpha 01', 'Beta 02'], ''],
		[[], '']
	] as [string[], string][]) {
		expect(sharedFilenamePrefix(names)).toBe(expected);
	}
});

test('remove parent names from albums and collections regardless of sibling names', async ({
	page
}) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'album', exact: true }).press('ArrowRight');
	await expectSavedFolders(page, ['album/']);
	await page.evaluate(async () => {
		const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('comics');
		const original = await directory.getDirectoryHandle('album');
		const image = await (await original.getFileHandle('01.png')).getFile();
		for (const series of ['Series', 'Another series']) {
			const collection = await directory.getDirectoryHandle(series, { create: true });
			for (const number of ['001', '002']) {
				const album = await collection.getDirectoryHandle(
					`${series.toUpperCase()} — _ ✨ ${number}`,
					{
						create: true
					}
				);
				const writer = await (
					await album.getFileHandle('01.png', { create: true })
				).createWritable();
				await writer.write(image);
				await writer.close();
			}
			for (const path of [`${series} -- Extras/Only album`, 'Unrelated']) {
				let folder = collection;
				for (const name of path.split('/'))
					folder = await folder.getDirectoryHandle(name, { create: true });
				const writer = await (
					await folder.getFileHandle('01.png', { create: true })
				).createWritable();
				await writer.write(image);
				await writer.close();
			}
		}
		const archives = await directory.getDirectoryHandle('Archives', { create: true });
		for (const name of ['ARCHIVES - 001.cbz', 'Unrelated.cbz', 'Archives.cbz'])
			await archives.getFileHandle(name, { create: true });
	});
	await page.reload();
	for (const series of ['Series', 'Another series']) {
		const collection = page.getByRole('treeitem', { name: `${series}/`, exact: true });
		await collection.press('ArrowRight');
		await expect(
			collection.getByRole('treeitem', { name: 'Unrelated', exact: true })
		).toBeVisible();
		const extras = collection.getByRole('treeitem', { name: 'Extras/', exact: true });
		await expect(extras.getByText('Extras/', { exact: true })).toHaveAttribute(
			'title',
			`${series} -- Extras`
		);
		await extras.press('ArrowRight');
		await expect(extras.getByRole('treeitem', { name: 'Only album', exact: true })).toBeVisible();
		for (const number of ['001', '002']) {
			const album = collection.getByRole('treeitem', { name: number, exact: true });
			await expect(album.getByText(number, { exact: true })).toHaveAttribute(
				'title',
				`${series.toUpperCase()} — _ ✨ ${number}`
			);
			await album.click();
			await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
				'data-page-path',
				`${series}/${series.toUpperCase()} — _ ✨ ${number}/01.png`
			);
			await expect(
				page
					.getByRole('region', { name: 'Album pages' })
					.getByRole('button', { name: '01', exact: true })
			).toHaveAttribute('aria-current', 'page');
		}
	}
	const archives = page.getByRole('treeitem', { name: 'Archives/', exact: true });
	await archives.press('ArrowRight');
	const archive = archives.getByRole('treeitem', { name: '001', exact: true });
	await expect(archive).toHaveAttribute('aria-disabled', 'false');
	await expect(archive.getByText('001', { exact: true })).toHaveAttribute(
		'title',
		'ARCHIVES - 001.cbz'
	);
});

test('parent prefixes ignore case and strip separators without changing remaining letters or digits', () => {
	for (const [name, parent, expected] of [
		['SERIES — _ ✨ 001', 'Series', '001'],
		['Series2026', 'Series', '2026'],
		['Series -- Éclair', 'series', 'Éclair'],
		['Series — 日本語', 'Series', '日本語'],
		['Series._+-', 'Series', 'Series._+-'],
		['Series', 'series', 'Series'],
		['Unrelated', 'Series', 'Unrelated']
	])
		expect(withoutParentPrefix(name, parent)).toBe(expected);
});

test('page headings match collection plus album across separators without changing suffixes', () => {
	for (const [name, collection, album, expected] of [
		['SERIES — _ ✨ Volume_001', 'Series', 'Volume', '001'],
		['SeriesVolume002', 'Series', 'Volume', '002'],
		['The — Series ✨ Vol. 2 — Éclair', 'The Series', 'Vol 2', 'Éclair'],
		['Series — Volume_003', 'Series', 'Series - Volume', '003'],
		['SeriesSeriesVolume004', 'Series', 'Series - Volume', '004'],
		['本棚 — 巻一 _ 日本語', '本棚', '巻一', '日本語'],
		['Series — Volume --', 'Series', 'Volume', 'Series — Volume --'],
		['SeriesVolume', 'Series', 'Volume', 'SeriesVolume'],
		['Another Volume001', 'Series', 'Volume', 'Another Volume001'],
		['SeriesOther001', 'Series', 'Volume', 'SeriesOther001'],
		['Volume001', '', 'Volume', 'Volume001']
	])
		expect(withoutAlbumPrefix(name, collection, album)).toBe(expected);
});

test('shorten collection and album page headings in both panes while keeping source filenames', async ({
	page
}) => {
	await setupDirectory(page);
	await page.getByRole('treeitem', { name: 'album', exact: true }).press('ArrowRight');
	await expectSavedFolders(page, ['album/']);
	await page.evaluate(async () => {
		const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('comics');
		const image = await (
			await (await root.getDirectoryHandle('album')).getFileHandle('01.png')
		).getFile();
		const collection = await root.getDirectoryHandle('Series', { create: true });
		const album = await collection.getDirectoryHandle('Volume', { create: true });
		for (const name of ['Series — Volume_001.png', 'SERIES✨VOLUME002.png']) {
			const writer = await (await album.getFileHandle(name, { create: true })).createWritable();
			await writer.write(image);
			await writer.close();
		}
	});
	await page.reload();
	const collection = page.getByRole('treeitem', { name: 'Series/', exact: true });
	await collection.press('ArrowRight');
	const album = collection.getByRole('treeitem', { name: 'Volume', exact: true });
	await album.press('ArrowRight');
	await album.getByRole('treeitem', { name: '1', exact: true }).click();
	const pane = page.getByRole('region', { name: 'Album pages' });
	await expect(pane.getByRole('button', { name: '1', exact: true })).toHaveAttribute(
		'title',
		'Series — Volume_001.png'
	);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'Series/Volume/Series — Volume_001.png'
	);
	await pane.getByRole('button', { name: '2', exact: true }).click();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'Series/Volume/SERIES✨VOLUME002.png'
	);
});

test('language dropdown flags reflect the selected page and reader mode without disabling languages', async ({
	page
}) => {
	await setupDirectory(page, false, true, true);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	await album.press('ArrowRight');
	await album.click();
	const first = album.getByRole('treeitem', { name: /^0?1$/, exact: true });
	const second = album.getByRole('treeitem', { name: /^0?2$/, exact: true });
	async function expectFlags(selected: string, english: string, dutch: string) {
		const trigger = page.getByRole('menuitem', { name: selected, exact: true });
		await expect(trigger.locator('img')).toHaveCSS('filter', selected === 'EN' ? english : dutch);
		await trigger.click();
		await expect(
			page.getByRole('menuitemradio', { name: 'English (EN)', exact: true }).locator('img')
		).toHaveCSS('filter', english);
		await expect(
			page.getByRole('menuitemradio', { name: 'Dutch (NL)', exact: true }).locator('img')
		).toHaveCSS('filter', dutch);
		await page.keyboard.press('Escape');
	}
	// The first page has BBL files, while the second has an EN image and no BBL files.
	await expectFlags('EN', 'grayscale(1)', 'grayscale(1)');
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expectFlags('EN', 'none', 'none');
	await second.click();
	await expectFlags('EN', 'none', 'grayscale(1)');
	await page.getByRole('button', { name: 'Reading Mode', exact: true }).click();
	await expectFlags('EN', 'none', 'grayscale(1)');
	await chooseLanguage(page, 'EN', 'NL');
	await page.keyboard.press('Escape');
	await expectFlags('NL', 'none', 'grayscale(1)');
	await first.click();
	await expectFlags('NL', 'grayscale(1)', 'grayscale(1)');
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expectFlags('NL', 'none', 'none');
});
