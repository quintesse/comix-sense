import { test, expect, type Page } from '@playwright/test';
import { png, zipBytes } from './archive-fixtures';

const bubble = (text: string) => ({
	text,
	lang: 'en',
	shape: {
		type: 'box',
		vs: [
			{ x: 80, y: 80 },
			{ x: 300, y: 180 }
		]
	}
});
const original = {
	lang: 'en',
	title: 'Keep this metadata',
	custom: { edition: 7 },
	font: { size: 24, family: ['serif'] },
	pages: [
		{ filename: '01.png', note: 'First page', bubbles: [bubble('Original')] },
		{ filename: '02.png', note: 'Other page', bubbles: [bubble('Untouched')] }
	]
};

async function setup(
	page: Page,
	options: { empty?: boolean; archive?: boolean; archiveIndex?: boolean; nested?: boolean } = {}
) {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'languages', { value: ['en'] });
		FileSystemHandle.prototype.queryPermission = async () => 'granted';
		FileSystemHandle.prototype.requestPermission = async () =>
			localStorage.getItem('denyWrite') ? 'denied' : 'granted';
		Object.defineProperty(window, 'showDirectoryPicker', {
			value: async () => {
				const root = await navigator.storage.getDirectory();
				const parent = await root.getDirectoryHandle(
					localStorage.getItem('fixtureRoot') ?? 'first'
				);
				return parent.getDirectoryHandle('comics');
			}
		});
	});
	await page.goto('./');
	const archiveFiles: Record<string, Uint8Array> = { 'pages/01.png': png };
	if (options.archiveIndex) {
		archiveFiles['pages/02.png'] = png;
		archiveFiles['album.en.bbl'] = new TextEncoder().encode(
			JSON.stringify({
				...original,
				pages: original.pages.map((p) => ({ ...p, filename: 'pages/' + p.filename }))
			})
		);
	} else if (!options.empty) {
		archiveFiles['pages/01.png.en.bbl'] = new TextEncoder().encode(
			JSON.stringify({
				...original,
				pages: [{ note: 'Archive metadata', bubbles: [bubble('Archive original')] }]
			})
		);
	}
	const archive = options.archive ? [...(await zipBytes(archiveFiles))] : undefined;
	await page.evaluate(
		async ({ original, empty, archive, nested }) => {
			const root = await navigator.storage.getDirectory();
			for (const parent of ['first', 'second']) {
				const dir = await (
					await root.getDirectoryHandle(parent, { create: true })
				).getDirectoryHandle('comics', { create: true });
				const write = async (
					directory: FileSystemDirectoryHandle,
					name: string,
					data: string | Blob
				) => {
					const writer = await (
						await directory.getFileHandle(name, { create: true })
					).createWritable();
					await writer.write(data);
					await writer.close();
				};
				if (archive) {
					await write(dir, 'book.cbz', new Blob([new Uint8Array(archive)]));
					continue;
				}
				let albumParent = dir;
				if (nested) {
					await dir.getDirectoryHandle('unrelated', { create: true });
					for (const name of ['series', 'collection'])
						albumParent = await albumParent.getDirectoryHandle(name, { create: true });
				}
				const album = await albumParent.getDirectoryHandle('album', { create: true });
				const canvas = document.createElement('canvas');
				canvas.width = 800;
				canvas.height = 1000;
				const image = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
				for (const name of ['01.png', '02.png']) await write(album, name, image);
				if (!empty) await write(album, 'album.en.bbl', JSON.stringify(original));
			}
		},
		{ original, empty: options.empty, archive, nested: options.nested }
	);
	await page.getByRole('button', { name: 'Add folder' }).click();
	if (options.nested)
		for (const name of ['series/', 'collection/'])
			await page.getByRole('treeitem', { name, exact: true }).press('ArrowRight');
	const album = page.getByRole('treeitem', {
		name: options.archive ? 'book' : 'album',
		exact: true
	});
	await album.press('ArrowRight');
	await album.getByRole('treeitem').first().click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Single Page', exact: true }).click();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
}

async function backups(page: Page): Promise<Record<string, any>> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const request = indexedDB.open('comix-sense-bbl', 1);
			request.onsuccess = () => resolve(request.result);
		});
		try {
			return await new Promise<Record<string, any>>((resolve) => {
				const request = db.transaction('workspaces').objectStore('workspaces').getAll();
				request.onsuccess = () =>
					resolve(
						Object.fromEntries(
							request.result
								.flatMap((record) => Object.entries(record.documents))
								.map(([path, text]) => [path, JSON.parse(text as string)])
						)
					);
			});
		} finally {
			db.close();
		}
	});
}

async function disk(page: Page, path = 'album/album.en.bbl') {
	return page.evaluate(async (path) => {
		const root = await navigator.storage.getDirectory();
		let dir = await (await root.getDirectoryHandle('first')).getDirectoryHandle('comics');
		const parts = path.split('/');
		const name = parts.pop()!;
		try {
			for (const part of parts) dir = await dir.getDirectoryHandle(part);
			return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotFoundError') return null;
			throw error;
		}
	}, path);
}

async function writeDocuments(page: Page, documents: Record<string, unknown>, removeIndex = false) {
	await page.evaluate(
		async ({ documents, removeIndex }) => {
			const root = await (
				await (await navigator.storage.getDirectory()).getDirectoryHandle('first')
			).getDirectoryHandle('comics');
			if (removeIndex) await (await root.getDirectoryHandle('album')).removeEntry('album.en.bbl');
			for (const [path, document] of Object.entries(documents)) {
				let dir = root;
				const parts = path.split('/');
				const name = parts.pop()!;
				for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
				const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
				await writer.write(JSON.stringify(document));
				await writer.close();
			}
		},
		{ documents, removeIndex }
	);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
}

async function selectLanguage(page: Page, current: string, next: string) {
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
}

async function confirmDiscard(page: Page) {
	await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Discard Changes?' })
		.getByRole('button', { name: 'Discard Changes', exact: true })
		.click();
}

test('back up edits as .bbl documents, restore in another tab, and confirm discard', async ({
	page,
	context
}) => {
	await setup(page);
	await page.getByRole('button', { name: 'Reading Mode', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeHidden();
	await expect(page.getByRole('button', { name: 'Discard Changes', exact: true })).toBeHidden();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
	await page.getByRole('textbox').fill('Browser edit');
	await expect
		.poll(async () => (await backups(page))['album/album.en.bbl']?.pages[0].bubbles[0].text)
		.toBe('Browser edit');
	const saved = (await backups(page))['album/album.en.bbl'];
	expect(saved).toMatchObject({
		title: original.title,
		custom: original.custom,
		font: original.font
	});
	expect(saved.pages[1]).toEqual(original.pages[1]);
	expect(await disk(page)).toEqual(original);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Browser edit');
	const reopened = await context.newPage();
	await reopened.addInitScript(() => {
		FileSystemHandle.prototype.queryPermission = async () => 'granted';
	});
	await reopened.goto('./');
	await expect(reopened.locator('foreignObject')).toHaveText('Browser edit');
	await reopened.close();
	const discard = page
		.getByRole('group', { name: 'Document changes' })
		.getByRole('button', { name: 'Discard Changes', exact: true });
	await discard.click();
	const dialog = page.getByRole('dialog', { name: 'Discard Changes?' });
	await expect(dialog).toContainText('all unsaved changes');
	await page.screenshot({
		path: test.info().outputPath('discard-confirmation.png'),
		animations: 'disabled'
	});
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator('foreignObject')).toHaveText('Browser edit');
	await discard.click();
	await dialog.getByRole('button', { name: 'Discard Changes', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Original');
	expect(await backups(page)).toEqual({});
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Original');
});

test('save text and geometry to the original document, preserving other pages and metadata', async ({
	page
}) => {
	await setup(page);
	await page.getByRole('textbox').fill('Saved edit');
	const handle = page.locator('circle').last();
	const bounds = (await handle.boundingBox())!;
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + 30, bounds.y + 30);
	await page.mouse.up();
	await page.screenshot({
		path: test.info().outputPath('save-toolbar.png'),
		animations: 'disabled'
	});
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	const result = await disk(page);
	expect(result).toMatchObject({
		title: original.title,
		lang: original.lang,
		custom: original.custom,
		font: original.font
	});
	expect(result.pages[0].note).toBe('First page');
	expect(result.pages[0].bubbles[0].text).toBe('Saved edit');
	expect(result.pages[0].bubbles[0].shape).not.toEqual(original.pages[0].bubbles[0].shape);
	expect(result.pages[1]).toEqual(original.pages[1]);
	expect(await backups(page)).toEqual({});
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Saved edit');
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
});

test('write denial retains backups and edits, and same-named roots stay independent', async ({
	page
}) => {
	await setup(page);
	await page.getByRole('textbox').fill('First root only');
	await page.evaluate(() => localStorage.setItem('denyWrite', 'yes'));
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Write permission was not granted');
	await expect(page.getByRole('textbox')).toHaveText('First root only');
	expect(await disk(page)).toEqual(original);
	await expect
		.poll(async () => (await backups(page))['album/album.en.bbl']?.pages[0].bubbles[0].text)
		.toBe('First root only');
	await page.evaluate(() => localStorage.setItem('fixtureRoot', 'second'));
	await page.getByRole('button', { name: 'Add folder' }).click();
	await expect(page.getByRole('treeitem', { name: 'comics/', exact: true })).toHaveCount(2);
	const album = page.getByRole('treeitem', { name: 'album', exact: true }).last();
	await album.press('ArrowRight');
	await album.getByRole('treeitem').first().click();
	await expect(page.locator('foreignObject')).toHaveText('Original');
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
});

test('scan restores OCR and MRG and saves only the selected language document', async ({
	page
}) => {
	await setup(page, { empty: true });
	await page.route('https://vision.googleapis.com/**', (route) =>
		route.fulfill({
			json: {
				responses: [
					{
						textAnnotations: [
							{ description: 'Hello world', locale: 'en' },
							{
								description: 'Hello',
								boundingPoly: {
									vertices: [
										{ x: 80, y: 80 },
										{ x: 170, y: 120 }
									]
								}
							},
							{
								description: 'world',
								boundingPoly: {
									vertices: [
										{ x: 180, y: 80 },
										{ x: 280, y: 120 }
									]
								}
							}
						]
					}
				]
			}
		})
	);
	await page.getByRole('button', { name: 'Scan Full Page' }).click();
	await page.getByLabel('Google Vision API key', { exact: true }).fill('test-key');
	await page.getByRole('button', { name: 'Use key', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await expect
		.poll(async () => Object.keys(await backups(page)).sort())
		.toEqual(['album/01.MRG.bbl', 'album/01.OCR.bbl']);
	expect(await disk(page, 'album/01.OCR.bbl')).toBeNull();
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await page.getByRole('menuitem', { name: 'MRG', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'OCR', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText(['Hello', 'world']);
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect(await disk(page, 'album/01.MRG.bbl')).toBeNull();
	expect((await disk(page, 'album/01.OCR.bbl')).pages[0].bubbles).toHaveLength(2);
	expect(Object.keys(await backups(page))).toEqual(['album/01.MRG.bbl']);
	await page.getByRole('menuitem', { name: 'OCR', exact: true }).click();
	await expect(page.getByRole('menuitemradio', { name: 'MRG', exact: true })).toHaveCSS(
		'font-weight',
		'700'
	);
	await expect(page.getByRole('menuitemradio', { name: 'OCR', exact: true })).not.toHaveCSS(
		'font-weight',
		'700'
	);
	await page.getByRole('menuitemradio', { name: 'MRG', exact: true }).click();
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect(await disk(page, 'album/01.MRG.bbl')).not.toBeNull();
	expect((await disk(page, 'album/01.MRG.bbl')).pages[0].bubbles[0].text).toBe('Hello world');
	expect(await backups(page)).toEqual({});
});

test('embedded archive sources save the same document in the companion directory', async ({
	page
}) => {
	await setup(page, { archive: true });
	await page.getByRole('textbox').fill('Archive edit');
	const path = 'book.cbz.bbl/pages/01.png.en.bbl';
	await expect
		.poll(async () => (await backups(page))[path]?.pages[0].bubbles[0].text)
		.toBe('Archive edit');
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Archive edit');
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect((await disk(page, path)).pages[0]).toMatchObject({
		note: 'Archive metadata',
		bubbles: [{ text: 'Archive edit' }]
	});
	expect(await disk(page, 'book.cbz.bbl/pages/01.en.bbl')).toBeNull();
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Archive edit');
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('textbox').fill('Discard this edit');
	await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Discard Changes?' })
		.getByRole('button', { name: 'Discard Changes', exact: true })
		.click();
	await expect(page.locator('foreignObject')).toHaveText('Archive edit');
	expect(await backups(page)).toEqual({});
	await expect(page.getByRole('treeitem', { name: 'book.cbz.bbl/', exact: true })).toHaveCount(0);
});

test('deleting the last bubble persists an empty overlay and discard restores it', async ({
	page
}) => {
	await setup(page);
	await page.getByRole('textbox').click({ button: 'right' });
	await page.getByText('Delete', { exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await expect
		.poll(async () => (await backups(page))['album/album.en.bbl']?.pages[0].bubbles)
		.toEqual([]);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Discard Changes?' })
		.getByRole('button', { name: 'Discard Changes', exact: true })
		.click();
	await expect(page.locator('foreignObject')).toHaveText('Original');
});

test('failed disk writes preserve edits and browser backups for retry', async ({ page }) => {
	await setup(page);
	await page.getByRole('textbox').fill('Retry this save');
	await page.evaluate(() => {
		const createWritable = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = async function (...args) {
			if (this.name.endsWith('.bbl')) throw new DOMException('Disk is full', 'QuotaExceededError');
			return createWritable.apply(this, args);
		};
	});
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Disk is full');
	await expect(page.getByRole('textbox')).toHaveText('Retry this save');
	expect(await disk(page)).toEqual(original);
	expect((await backups(page))['album/album.en.bbl'].pages[0].bubbles[0].text).toBe(
		'Retry this save'
	);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Retry this save');
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
});

test('browser backup failure is visible and does not block editing or explicit disk saving', async ({
	page
}) => {
	await setup(page);
	await page.evaluate(() => {
		const put = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (...args) {
			if (this.name === 'workspaces')
				throw new DOMException('Browser storage is full', 'QuotaExceededError');
			return put.apply(this, args as [any, IDBValidKey?]);
		};
	});
	await page.getByRole('textbox').fill('Still editable');
	await expect(page.getByRole('alert')).toContainText('Could not back up edits');
	await expect(page.getByRole('textbox')).toHaveText('Still editable');
	// Disk saving still works while IndexedDB puts continue to fail.
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect((await disk(page)).pages[0].bubbles[0].text).toBe('Still editable');
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('edits to two pages sharing an album document are combined in one backup and disk save', async ({
	page
}) => {
	await setup(page);
	await page.getByRole('textbox').fill('First edited');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await page.getByRole('textbox').fill('Second edited');
	await expect
		.poll(async () =>
			(await backups(page))['album/album.en.bbl']?.pages.map((p: any) => p.bubbles[0].text)
		)
		.toEqual(['First edited', 'Second edited']);
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect((await disk(page)).pages.map((p: any) => p.bubbles[0].text)).toEqual([
		'First edited',
		'Second edited'
	]);
});

test('scoped saves retain other documents and preserve saved page edits on later saves', async ({
	page
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const modulePath = '/src/lib/types/ComicStore.ts';
		const { DirectoryComicStore } = await import(/* @vite-ignore */ modulePath);
		const dir = await (
			await (await navigator.storage.getDirectory()).getDirectoryHandle('first')
		).getDirectoryHandle('comics');
		const album = await dir.getDirectoryHandle('album');
		const writer = await (
			await album.getFileHandle('01.png.nl.bbl', { create: true })
		).createWritable();
		await writer.write(
			JSON.stringify({
				pages: [
					{
						bubbles: [
							{
								text: 'Dutch',
								shape: {
									type: 'box',
									vs: [
										{ x: 0, y: 0 },
										{ x: 100, y: 100 }
									]
								}
							}
						]
					}
				]
			})
		);
		await writer.close();
		const store = new DirectoryComicStore(dir);
		const pages = (await store.list()).filter((comic: any) => comic.kind === 'page');
		const edit = async (index: number, language: string, text: string) => {
			const bubbles = structuredClone(await pages[index].getBubbles(language));
			bubbles[0].text = text;
			await pages[index].editBubbles(language, bubbles);
		};
		await edit(0, 'en', 'First saved');
		await edit(1, 'en', 'Second saved');
		await edit(0, 'nl', 'Dutch edited');
		const createWritable = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = async function (...args) {
			if (this.name === '01.png.nl.bbl') throw new Error('Second document failed');
			return createWritable.apply(this, args);
		};
		let error = '';
		try {
			await store.workspace.save('album/01.png.nl.bbl');
		} catch (failure) {
			error = String(failure);
		}
		FileSystemFileHandle.prototype.createWritable = createWritable;
		const retained = store.workspace.paths();
		await store.workspace.save('album/album.en.bbl');
		// Re-editing a successfully written document must retain its other edited page.
		await edit(0, 'en', 'First edited again');
		await store.workspace.save('album/album.en.bbl');
		await store.workspace.save('album/01.png.nl.bbl');
		store.dispose();
		return { error, retained };
	});
	expect(result.error).toContain('Second document failed');
	expect(result.retained.sort()).toEqual(['album/01.png.nl.bbl', 'album/album.en.bbl']);
	expect((await disk(page)).pages.map((p: any) => p.bubbles[0].text)).toEqual([
		'First edited again',
		'Second saved'
	]);
	expect((await disk(page, 'album/01.png.nl.bbl')).pages[0].bubbles[0].text).toBe('Dutch edited');
	expect(await backups(page)).toEqual({});
});

test('unsaved pages and albums have outline icons and bold names until saved or discarded', async ({
	page
}) => {
	await setup(page);
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const first = album.getByRole('treeitem', { name: /^0?1$/, exact: true });
	const second = album.getByRole('treeitem', { name: /^0?2$/, exact: true });
	const albumName = album.locator(':scope > div span[title="album"]');
	const firstName = first.locator('span[title="01.png"]');
	const secondName = second.locator('span[title="02.png"]');
	const albumIcon = album.locator(':scope > div [data-comic-icon="album"]');
	await expect(albumIcon).toHaveAttribute('data-icon-style', 'solid');
	await expect(firstName).not.toHaveCSS('font-weight', '700');
	await page.getByRole('textbox').fill('Unsaved page');
	await expect(firstName).toHaveCSS('font-weight', '700');
	await expect(first.locator('[data-comic-icon="page"]')).toHaveAttribute(
		'data-icon-style',
		'regular'
	);
	await expect(albumName).toHaveCSS('font-weight', '700');
	await expect(albumIcon).toHaveAttribute('data-icon-style', 'regular');
	await expect(albumIcon).toHaveCSS('fill', 'none');
	await expect(first.locator('[data-comic-icon="page"]')).toHaveCSS('fill', 'none');
	await expect(secondName).not.toHaveCSS('font-weight', '700');
	await expect
		.poll(async () => (await backups(page))['album/album.en.bbl']?.pages[0].bubbles[0].text)
		.toBe('Unsaved page');
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(firstName).toHaveCSS('font-weight', '700');
	await expect(secondName).not.toHaveCSS('font-weight', '700');
	await expect(albumIcon).toHaveAttribute('data-icon-style', 'regular');
	// Unsaved work remains visible even while displaying the original image.
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'ORG', exact: true }).click();
	await expect(first.locator('[data-comic-icon="page"]')).toHaveAttribute(
		'data-icon-style',
		'regular'
	);
	await page.getByRole('menuitem', { name: 'ORG', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'English (EN)', exact: true }).click();
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(albumIcon).toHaveAttribute('data-icon-style', 'solid');
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'ORG', exact: true }).click();
	await expect(first.locator('[data-comic-icon="page"]')).toHaveAttribute(
		'data-icon-style',
		'solid'
	);
	await expect(firstName).not.toHaveCSS('font-weight', '700');
	await expect(albumName).not.toHaveCSS('font-weight', '700');
	await page.getByRole('menuitem', { name: 'ORG', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'English (EN)', exact: true }).click();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('textbox').fill('Discard this edit');
	await expect(albumName).toHaveCSS('font-weight', '700');
	await page.screenshot({
		path: test.info().outputPath('unsaved-indicators.png'),
		animations: 'disabled'
	});
	await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Discard Changes?' })
		.getByRole('button', { name: 'Discard Changes', exact: true })
		.click();
	await expect(firstName).not.toHaveCSS('font-weight', '700');
	await expect(albumName).not.toHaveCSS('font-weight', '700');
	await expect(albumIcon).toHaveAttribute('data-icon-style', 'solid');
});

test('an edited archive page marks its album, including while collapsed and after reload', async ({
	page
}) => {
	await setup(page, { archive: true });
	const archive = page.getByRole('treeitem', { name: 'book', exact: true });
	const icon = archive.locator(':scope > div [data-comic-icon="album"]');
	const label = archive.locator(':scope > div span[title="book.cbz"]');
	await expect(icon).toHaveAttribute('data-icon-style', 'solid');
	await page.getByRole('textbox').fill('Unsaved archive page');
	await expect(icon).toHaveAttribute('data-icon-style', 'regular');
	await expect(icon).toHaveCSS('fill', 'none');
	await expect(label).toHaveCSS('font-weight', '700');
	await archive.press('ArrowLeft');
	await expect(archive).toHaveAttribute('aria-expanded', 'false');
	await expect(icon).toHaveAttribute('data-icon-style', 'regular');
	await expect.poll(async () => Object.keys(await backups(page))).toHaveLength(1);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(icon).toHaveAttribute('data-icon-style', 'regular');
	await expect(label).toHaveCSS('font-weight', '700');
	await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Discard Changes?' })
		.getByRole('button', { name: 'Discard Changes', exact: true })
		.click();
	await expect(icon).toHaveAttribute('data-icon-style', 'solid');
	await expect(label).not.toHaveCSS('font-weight', '700');
});

test('unsaved indicators reach every ancestor up to the root without marking sibling branches', async ({
	page
}) => {
	await setup(page, { nested: true });
	const root = page.getByRole('treeitem', { name: 'comics/', exact: true });
	const series = page.getByRole('treeitem', { name: 'series/', exact: true });
	const collection = page.getByRole('treeitem', { name: 'collection/', exact: true });
	const album = page.getByRole('treeitem', { name: 'album', exact: true });
	const sibling = page.getByRole('treeitem', { name: 'unrelated/', exact: true });
	const rows = [root, series, collection, album];
	const icon = (row: typeof root) => row.locator(':scope > div [data-comic-icon]');
	const label = (row: typeof root) =>
		row.locator(':scope > div .folder-name, :scope > div span[title]');
	for (const row of rows) await expect(icon(row)).toHaveAttribute('data-icon-style', 'solid');
	await page.getByRole('textbox').fill('Nested edit');
	for (const row of rows) {
		await expect(icon(row)).toHaveCSS('fill', 'none');
		await expect(label(row)).toHaveCSS('font-weight', '700');
	}
	await expect(icon(sibling)).toHaveAttribute('data-icon-style', 'solid');
	await expect(label(sibling)).not.toHaveCSS('font-weight', '700');
	await expect.poll(async () => Object.keys(await backups(page))).toHaveLength(1);
	await root.press('ArrowLeft');
	await expect(root).toHaveAttribute('aria-expanded', 'false');
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(icon(root)).toHaveCSS('fill', 'none');
	await expect(label(root)).toHaveCSS('font-weight', '700');
	await root.press('ArrowRight');
	for (const row of rows) await expect(icon(row)).toHaveCSS('fill', 'none');
	await page.screenshot({
		path: test.info().outputPath('unsaved-hierarchy.png'),
		animations: 'disabled'
	});
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	for (const row of rows) {
		await expect(icon(row)).toHaveAttribute('data-icon-style', 'solid');
		await expect(label(row)).not.toHaveCSS('font-weight', '700');
	}
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('textbox').fill('Discard nested edit');
	await expect(label(root)).toHaveCSS('font-weight', '700');
	await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Discard Changes?' })
		.getByRole('button', { name: 'Discard Changes', exact: true })
		.click();
	for (const row of rows) {
		await expect(icon(row)).toHaveAttribute('data-icon-style', 'solid');
		await expect(label(row)).not.toHaveCSS('font-weight', '700');
	}
});

test('Save and Discard affect only the selected page-language source file', async ({ page }) => {
	await setup(page);
	const docs = Object.fromEntries(
		['en', 'nl', 'es'].flatMap((language) =>
			original.pages.map((p) => [
				`album/${p.filename}.${language}.bbl`,
				{ ...original, lang: language, pages: [p] }
			])
		)
	);
	await writeDocuments(page, docs, true);
	await page.getByRole('textbox').fill('English edit');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await page.getByRole('textbox').fill('Second page pending');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await selectLanguage(page, 'EN', 'NL');
	await page.getByRole('textbox').fill('Dutch edit');
	await expect(page.getByRole('menuitem', { name: 'NL', exact: true })).toHaveCSS(
		'font-weight',
		'700'
	);
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveAttribute(
		'title',
		'Save changes to album/01.png.nl.bbl'
	);
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect((await disk(page, 'album/01.png.nl.bbl')).pages[0].bubbles[0].text).toBe('Dutch edit');
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
	expect((await disk(page, 'album/01.png.en.bbl')).pages[0].bubbles[0].text).toBe('Original');
	expect((await disk(page, 'album/02.png.en.bbl')).pages[0].bubbles[0].text).toBe('Untouched');
	expect(Object.keys(await backups(page)).sort()).toEqual([
		'album/01.png.en.bbl',
		'album/02.png.en.bbl'
	]);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('menuitem', { name: 'NL', exact: true }).click();
	await expect(page.getByRole('menuitemradio', { name: 'English (EN)', exact: true })).toHaveCSS(
		'font-weight',
		'700'
	);
	await expect(page.getByRole('menuitemradio', { name: 'Dutch (NL)', exact: true })).not.toHaveCSS(
		'font-weight',
		'700'
	);
	await expect(
		page.getByRole('menuitemradio', { name: 'Spanish (ES)', exact: true })
	).not.toHaveCSS('font-weight', '700');
	await page.getByRole('menuitemradio', { name: 'English (EN)', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('English edit');
	await confirmDiscard(page);
	await expect(page.locator('foreignObject')).toHaveText('Original');
	expect(Object.keys(await backups(page))).toEqual(['album/02.png.en.bbl']);
	expect((await disk(page, 'album/01.png.nl.bbl')).pages[0].bubbles[0].text).toBe('Dutch edit');
});

test('discarding an album document affects all its edited pages and preserves another language file', async ({
	page
}) => {
	await setup(page);
	await writeDocuments(page, { 'album/01.nl.bbl': { pages: [original.pages[0]] } });
	await page.getByRole('textbox').fill('First English edit');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await page.getByRole('textbox').fill('Second English edit');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await selectLanguage(page, 'EN', 'NL');
	await page.getByRole('textbox').fill('Keep Dutch edit');
	await selectLanguage(page, 'NL', 'EN');
	await confirmDiscard(page);
	await expect(page.locator('foreignObject')).toHaveText('Original');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Untouched');
	expect(Object.keys(await backups(page))).toEqual(['album/01.nl.bbl']);
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await selectLanguage(page, 'EN', 'NL');
	await expect(page.locator('foreignObject')).toHaveText('Keep Dutch edit');
});

test('an embedded album index saves as a companion index with the same name and page scope', async ({
	page
}) => {
	await setup(page, { archive: true, archiveIndex: true });
	const rows = page.getByRole('treeitem', { name: 'book', exact: true }).getByRole('treeitem');
	await page.getByRole('textbox').fill('First archive edit');
	await rows.nth(1).click();
	await page.getByRole('textbox').fill('Second archive edit');
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveAttribute(
		'title',
		'Save changes to book.cbz.bbl/album.en.bbl'
	);
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect(await disk(page, 'book.cbz.bbl/album.en.bbl')).not.toBeNull();
	const saved = await disk(page, 'book.cbz.bbl/album.en.bbl');
	expect(saved.pages.map((p: any) => p.bubbles[0].text)).toEqual([
		'First archive edit',
		'Second archive edit'
	]);
	expect(saved.custom).toEqual(original.custom);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second archive edit');
	await rows.nth(0).click();
	await expect(page.locator('foreignObject')).toHaveText('First archive edit');
});

test('companion indexes override embedded sidecars and retain their own path when saved', async ({
	page
}) => {
	await setup(page, { archive: true });
	await writeDocuments(page, {
		'book.cbz.bbl/album.en.bbl': {
			...original,
			pages: [{ filename: 'pages/01.png', bubbles: [bubble('Companion wins')] }]
		}
	});
	await expect(page.getByRole('textbox')).toHaveText('Companion wins');
	await page.getByRole('textbox').fill('Companion edited');
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect((await disk(page, 'book.cbz.bbl/album.en.bbl')).pages[0].bubbles[0].text).toBe(
		'Companion edited'
	);
	expect(await disk(page, 'book.cbz.bbl/pages/01.png.en.bbl')).toBeNull();
});

test('new archive overlays use the image stem and language in a companion directory', async ({
	page
}) => {
	await setup(page, { archive: true, empty: true });
	await page.evaluate(async () => {
		const modulePath = '/src/lib/types/ComicStore.ts';
		const { DirectoryComicStore } = await import(/* @vite-ignore */ modulePath);
		const dir = await (
			await (await navigator.storage.getDirectory()).getDirectoryHandle('first')
		).getDirectoryHandle('comics');
		const store = new DirectoryComicStore(dir);
		await store.list();
		const [comic] = await store.archive('book.cbz').list();
		await comic.editBubbles('es', [
			{
				text: 'Nuevo',
				lang: 'es',
				shape: {
					type: 'box',
					vs: [
						{ x: 0, y: 0 },
						{ x: 1, y: 1 }
					]
				}
			}
		]);
		await store.workspace.flush();
		store.dispose();
	});
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await selectLanguage(page, 'ORG', 'ES');
	await expect(page.locator('foreignObject')).toHaveText('Nuevo');
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	expect(await disk(page, 'book.cbz.bbl/pages/01.es.bbl')).not.toBeNull();
	expect((await disk(page, 'book.cbz.bbl/pages/01.es.bbl')).pages[0].filename).toBe('pages/01.png');
	expect(await disk(page, 'book.cbz.bbl/pages/01.png.es.bbl')).toBeNull();
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Nuevo');
});

test('AI album cleanup participates in browser backup, save and discard for every page', async ({
	page
}) => {
	await setup(page);
	await page.evaluate(() =>
		localStorage.setItem(
			'comix-sense.ai-settings',
			JSON.stringify({ url: 'https://ai.example/v1', model: 'test', apiKey: '' })
		)
	);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.route('https://ai.example/v1/chat/completions', async (route) => {
		const document = JSON.parse(route.request().postDataJSON().messages[1].content);
		expect(document.items).toHaveLength(2);
		document.items.forEach((item: { text: string }) => {
			item.text += '!';
		});
		await route.fulfill({
			json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }] }
		});
	});
	async function cleanup() {
		await page.getByRole('button', { name: 'Cleanup Text', exact: true }).click();
		await page.getByLabel('Scope', { exact: true }).selectOption('album');
		await page.getByRole('button', { name: 'Clean text', exact: true }).click();
		await expect(
			page.getByRole('status').filter({ hasText: '2 bubble texts updated' })
		).toBeVisible();
	}
	await cleanup();
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
	await expect
		.poll(async () =>
			(await backups(page))['album/album.en.bbl']?.pages.map((p: any) => p.bubbles[0].text)
		)
		.toEqual(['Original!', 'Untouched!']);
	expect(await disk(page)).toEqual(original);
	await confirmDiscard(page);
	await expect(page.getByRole('status').filter({ hasText: 'discarded' })).toBeVisible();
	await expect(page.locator('foreignObject')).toHaveText('Original');
	await cleanup();
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	const expected = {
		...structuredClone(original),
		pages: original.pages.map((p) => ({
			...structuredClone(p),
			bubbles: p.bubbles.map((b) => ({ ...structuredClone(b), font: {} }))
		}))
	};
	expected.pages.forEach((p) => {
		p.bubbles[0].text += '!';
	});
	expect(await disk(page)).toEqual(expected);
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
});

test('AI page translation backs up and saves a new language without changing the source album document', async ({
	page
}) => {
	await setup(page);
	await page.evaluate(() =>
		localStorage.setItem(
			'comix-sense.ai-settings',
			JSON.stringify({ url: 'https://ai.example/v1', model: 'test', apiKey: '' })
		)
	);
	await page.reload();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.route('https://ai.example/v1/chat/completions', async (route) => {
		const document = JSON.parse(route.request().postDataJSON().messages[1].content);
		document.items[0].text = 'Bonjour';
		await route.fulfill({
			json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }] }
		});
	});
	await page.getByRole('button', { name: 'Translate', exact: true }).click();
	await page
		.getByRole('dialog', { name: 'Translate page', exact: true })
		.getByRole('button', { name: 'OK', exact: true })
		.click();
	await expect(page.locator('foreignObject')).toHaveText('Bonjour');
	await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
	await expect
		.poll(async () => (await backups(page))['album/01.fr.bbl']?.pages[0].bubbles[0].text)
		.toBe('Bonjour');
	expect(await disk(page, 'album/01.fr.bbl')).toBeNull();
	await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved changes to' })).toBeVisible();
	const translated = await disk(page, 'album/01.fr.bbl');
	expect(translated.pages[0].bubbles[0]).toMatchObject({
		text: 'Bonjour',
		lang: 'fr',
		shape: original.pages[0].bubbles[0].shape
	});
	expect(await disk(page)).toEqual(original);
	await page.reload();
	await expect(page.locator('foreignObject')).toHaveText('Bonjour');
});
