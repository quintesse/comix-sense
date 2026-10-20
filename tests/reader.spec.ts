import { test, expect, type Page } from '@playwright/test';

declare global {
	interface Window {
		__filesRead: string[];
		__imageUrls: { created: string[]; revoked: string[] };
	}
}

// Exercise the app through its real directory-picker boundary without OS dialogs.
// File contents and asynchronous enumeration match the browser File System Access API.
async function mockDirectory(
	page: Page,
	options: {
		shuffled?: boolean;
		delayed?: boolean;
		cancel?: boolean;
		browserLanguages?: string[];
	} = {}
) {
	await page.addInitScript(({ shuffled, delayed, cancel, browserLanguages }) => {
		Object.defineProperty(navigator, 'languages', { value: browserLanguages ?? ['zz'] });
		window.__filesRead = [];
		window.__imageUrls = { created: [], revoked: [] };
		const createUrl = URL.createObjectURL.bind(URL);
		const revokeUrl = URL.revokeObjectURL.bind(URL);
		URL.createObjectURL = (blob) => {
			const url = createUrl(blob);
			window.__imageUrls.created.push(url);
			return url;
		};
		URL.revokeObjectURL = (url) => {
			window.__imageUrls.revoked.push(url);
			revokeUrl(url);
		};
		const bubble = (text: string) => ({
			text,
			shape: {
				type: 'box',
				vs: [
					{ x: 80, y: 80 },
					{ x: 300, y: 180 }
				]
			}
		});
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#ddd"/><text x="80" y="120">Original</text></svg>';
		const contents: Record<string, string> = {
			'album/01.png': svg,
			'album/01.en.bbl': JSON.stringify({ pages: [{ bubbles: [bubble('Hello')] }] }),
			'album/01.nl.bbl': JSON.stringify({ pages: [{ bubbles: [bubble('Hallo')] }] }),
			'album/02.png': svg,
			'album/02.en.bbl': JSON.stringify({ pages: [{ bubbles: [bubble('Second page')] }] }),
			'album/02.nl.bbl': JSON.stringify({ pages: [{ bubbles: [bubble('Tweede pagina')] }] })
		};
		function file(path: string) {
			return {
				kind: 'file',
				name: path.split('/').at(-1),
				path,
				async getFile() {
					if (delayed && path === 'album/01.en.bbl') await new Promise((r) => setTimeout(r, 500));
					window.__filesRead.push(path);
					return new File([contents[path]], path.split('/').at(-1)!, {
						type: path.endsWith('.png') ? 'image/svg+xml' : 'application/json'
					});
				}
			};
		}
		function directory(path: string): any {
			let paths = Object.keys(contents).filter(
				(p) => p.startsWith(path) && !p.slice(path.length).includes('/')
			);
			paths.sort();
			if (shuffled)
				paths = [
					...paths.filter((p) => p.endsWith('.png')),
					...paths.filter((p) => !p.endsWith('.png'))
				];
			const entries = path === '' ? [directory('album/')] : paths.map(file);
			return {
				kind: 'directory',
				name: path ? 'album' : 'comics',
				path,
				async *[Symbol.asyncIterator]() {
					for (const entry of entries) yield [entry.name, entry];
				},
				async *values() {
					yield* entries;
				},
				async resolve(entry: { path: string }) {
					return entry.path.replace(/\/$/, '').split('/');
				},
				async getDirectoryHandle(name: string) {
					const entry = entries.find((e) => e.kind === 'directory' && e.name === name);
					if (!entry) throw new DOMException('Not found', 'NotFoundError');
					return entry;
				},
				async getFileHandle(name: string) {
					const entry = entries.find((e) => e.kind === 'file' && e.name === name);
					if (!entry) throw new DOMException('Not found', 'NotFoundError');
					return entry;
				}
			};
		}
		Object.defineProperty(window, 'showDirectoryPicker', {
			value: async () => {
				if (cancel) throw new DOMException('Cancelled', 'AbortError');
				return directory('');
			}
		});
	}, options);
}

async function openComic(page: Page) {
	await page.goto('./');
	await page.getByRole('button', { name: 'Select directory...' }).click();
	await page.getByRole('treeitem', { name: 'album' }).click();
	await page.getByRole('treeitem', { name: 'album' }).press('ArrowRight');
	await page.getByRole('treeitem', { name: '01', exact: true }).click();
	await expect(page.locator('svg image').first()).toBeVisible();
}

async function selectMenu(page: Page, name: string, option: string) {
	await page.getByRole('menuitem', { name, exact: true }).click();
	await page.getByRole('menu', { name, exact: true }).getByText(option, { exact: true }).click();
	const newName = name.startsWith('EDIT:') ? 'EDIT: ' + option.toUpperCase() : option.toUpperCase();
	await expect(page.getByRole('menuitem', { name: newName, exact: true })).toBeVisible();
	if (await page.getByRole('menu', { name: newName, exact: true }).isVisible()) {
		await page.getByRole('menuitem', { name: newName, exact: true }).click();
	}
}

test('browse pages and switch language overlays', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await selectMenu(page, 'ORG', 'EN');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await page.getByRole('treeitem', { name: '02', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
});

test('remember zoom across reloads before any album is opened', async ({ page }) => {
	await page.goto('./');
	await expect(page.getByRole('button', { name: 'Select directory...' })).toBeVisible();
	await selectMenu(page, 'FIT', '75%');
	await page.reload();
	await expect(page.getByRole('menuitem', { name: '75%', exact: true })).toBeVisible();
	await selectMenu(page, '75%', 'Fit');
	await page.reload();
	await expect(page.getByRole('menuitem', { name: 'FIT', exact: true })).toBeVisible();
});

test('context menu choices update the reader and save zoom', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	const image = page.getByRole('img', { name: 'Comic page' });
	await image.click({ button: 'right', position: { x: 10, y: 10 } });
	await page.getByRole('menuitem', { name: 'Zoom', exact: true }).click();
	await page.getByRole('menuitemradio', { name: '75%', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: '75%', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await image.click({ button: 'right', position: { x: 10, y: 10 } });
	await page.getByRole('menuitem', { name: 'Language', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'NL', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hallo');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('comix-sense.zoom')))
		.toBe('75%');
});

for (const { preferences, expected } of [
	{ preferences: ['fr-FR', 'nl-NL', 'en-US'], expected: 'NL' },
	{ preferences: ['en-GB', 'nl'], expected: 'EN' },
	{ preferences: ['fr-FR', 'de-DE'], expected: 'ORG' }
]) {
	test(`select browser language from ${preferences.join(', ')}`, async ({ page }) => {
		await mockDirectory(page, { browserLanguages: preferences });
		await openComic(page);
		await expect(page.getByRole('menuitem', { name: expected, exact: true })).toBeVisible();
	});
}

test('edit text, resize a bubble and retain edits when switching languages', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await page.locator('[contenteditable=true]').fill('Edited text');
	const handle = page.locator('circle').last();
	const point = await handle.boundingBox();
	if (!point) throw new Error('Missing drag handle');
	await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
	await page.mouse.down();
	await page.mouse.move(point.x + point.width / 2 + 40, point.y + point.height / 2 + 30, {
		steps: 5
	});
	await page.mouse.up();
	await expect(page.locator('foreignObject')).not.toHaveAttribute('width', '220');
	await selectMenu(page, 'EN', 'NL');
	await expect(page.locator('foreignObject')).toHaveText('Hallo');
	await selectMenu(page, 'NL', 'EN');
	await expect(page.locator('foreignObject')).toHaveText('Edited text');
});

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
	const messages: string[] = [];
	errors.set(page, messages);
	page.on('pageerror', (error) => messages.push(error.message));
	page.on('console', (message) => {
		if (/ownership_invalid|effect_update_depth|binding_property_non_reactive/.test(message.text()))
			messages.push(message.text());
	});
});
test.afterEach(({ page }) => {
	expect(errors.get(page)).toEqual([]);
});

async function pagePoint(page: Page, x: number, y: number) {
	const box = await page.getByRole('img', { name: 'Comic page' }).boundingBox();
	if (!box) throw new Error('Missing comic page');
	return { x: box.x + (x * box.width) / 800, y: box.y + (y * box.height) / 1000 };
}

async function clickPage(page: Page, x: number, y: number) {
	const point = await pagePoint(page, x, y);
	await page.mouse.click(point.x, point.y);
}

test('draw, edit, convert and delete box and polygon bubbles', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'FIT', '100%');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await clickPage(page, 400, 300);
	await clickPage(page, 650, 420);
	await expect(page.locator('foreignObject')).toHaveCount(2);
	await page.getByRole('textbox').last().fill('New bubble');
	await expect(page.locator('#svgcontent rect').last()).toHaveAttribute('width', '250');
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Convert to Poly', { exact: true }).click();
	await expect(page.locator('#svgcontent polygon')).toHaveCount(1);
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Convert to Box', { exact: true }).click();
	await expect(page.locator('#svgcontent polygon')).toHaveCount(0);
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Delete', { exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(1);

	await selectMenu(page, 'BOX', 'Poly');
	await clickPage(page, 400, 300);
	await clickPage(page, 650, 300);
	await clickPage(page, 650, 450);
	await clickPage(page, 400, 300);
	await expect(page.locator('#svgcontent polygon')).toHaveCount(1);
	await expect(page.locator('#svgcontent polygon')).toHaveAttribute(
		'points',
		'400,300 650,300 650,450'
	);
	await page.screenshot({ path: test.info().outputPath('editor.png') });
});

test('cancel drawing with Escape and Backspace and reject a tiny box', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'FIT', '100%');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await clickPage(page, 400, 300);
	await page.keyboard.press('Escape');
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await clickPage(page, 400, 300);
	await page.keyboard.press('Backspace');
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await clickPage(page, 400, 300);
	await clickPage(page, 405, 305);
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await clickPage(page, 400, 300);
	await clickPage(page, 600, 400);
	await expect(page.locator('foreignObject')).toHaveCount(1);
});

test('fit and percentage zoom update after image load and resize in page coordinates', async ({
	page
}) => {
	await mockDirectory(page);
	await openComic(page);
	const image = page.getByRole('img', { name: 'Comic page' });
	await expect.poll(async () => (await image.boundingBox())?.height).toBeCloseTo(1052, 0);
	await selectMenu(page, 'FIT', 'Width');
	await expect.poll(async () => (await image.boundingBox())?.width).toBeCloseTo(1184, 0);
	await selectMenu(page, 'WIDTH', '50%');
	await expect.poll(async () => (await image.boundingBox())?.width).toBeCloseTo(400, 0);
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	const handle = await page.locator('circle').last().boundingBox();
	if (!handle) throw new Error('Missing drag handle');
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 30);
	await page.mouse.up();
	await expect(page.locator('foreignObject')).toHaveAttribute('width', '300');
	await expect(page.locator('foreignObject')).toHaveAttribute('height', '160');
	await selectMenu(page, '50%', 'Fit');
	await expect.poll(async () => (await image.boundingBox())?.height).toBeCloseTo(1052, 0);
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect.poll(async () => (await image.boundingBox())?.height).toBeCloseTo(852, 0);
});

test('fit avoids scrollbars and width only scrolls vertically, including after zoom and resize', async ({
	page
}) => {
	await mockDirectory(page);
	await openComic(page);
	const viewport = page.locator('main .viewport');
	// Force space-consuming scrollbars even on systems using overlay scrollbars.
	await page.addStyleTag({
		content: '.viewport::-webkit-scrollbar { width: 17px; height: 17px; }'
	});
	const overflow = () =>
		viewport.evaluate((element) => ({
			x: element.scrollWidth > element.clientWidth,
			y: element.scrollHeight > element.clientHeight
		}));

	for (const size of [
		{ width: 1440, height: 900 },
		{ width: 1100, height: 1100 },
		{ width: 1440, height: 1100 }
	]) {
		await page.setViewportSize(size);
		await expect.poll(overflow).toEqual({ x: false, y: false });
		await selectMenu(page, 'FIT', 'Width');
		await expect.poll(overflow).toEqual({ x: false, y: true });
		await page.setViewportSize({ ...size, width: size.width + 37 });
		await expect.poll(overflow).toEqual({ x: false, y: true });
		await expect
			.poll(() =>
				viewport.evaluate((element) => {
					const image = element.querySelector('svg')!;
					return Math.abs(image.getBoundingClientRect().width - element.clientWidth);
				})
			)
			.toBeLessThan(1);
		await selectMenu(page, 'WIDTH', '200%');
		await expect.poll(overflow).toEqual({ x: true, y: true });
		await selectMenu(page, '200%', 'Fit');
		await expect.poll(overflow).toEqual({ x: false, y: false });
		await expect
			.poll(() =>
				page.evaluate(() => ({
					x: document.documentElement.scrollWidth > window.innerWidth,
					y: document.documentElement.scrollHeight > window.innerHeight
				}))
			)
			.toEqual({ x: false, y: false });
	}
});

test('directory enumeration order does not lose pages or languages', async ({ page }) => {
	await mockDirectory(page, { shuffled: true });
	await openComic(page);
	await expect(page.getByRole('treeitem', { name: '01', exact: true })).toHaveCount(1);
	await selectMenu(page, 'ORG', 'EN');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await page.getByRole('treeitem', { name: '02', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
});

test('a slow language load cannot overwrite the newer page selection', async ({ page }) => {
	await mockDirectory(page, { delayed: true });
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await page.getByRole('treeitem', { name: '02', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
	await expect.poll(() => page.evaluate(() => window.__filesRead)).toContain('album/01.en.bbl');
	await expect(page.locator('foreignObject')).toHaveText('Second page');
});

test('cancelling the directory picker leaves the initial view usable', async ({ page }) => {
	await mockDirectory(page, { cancel: true });
	await page.goto('./');
	await page.getByRole('button', { name: 'Select directory...' }).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Select directory...' })).toBeVisible();
});

test('retain session edits across pages and release images only when leaving a page', async ({
	page
}) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await page.getByRole('textbox').fill('Retained edit');
	await selectMenu(page, 'EN', 'ORG');
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => window.__imageUrls.created.length)).toBe(1);
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(0);
	await selectMenu(page, 'ORG', 'EN');
	await expect(page.getByRole('textbox')).toHaveText('Retained edit');
	await page.getByRole('treeitem', { name: '02', exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText('Second page');
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(1);
	await page.getByRole('treeitem', { name: '01', exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText('Retained edit');
	await expect.poll(() => page.evaluate(() => window.__imageUrls.created.length)).toBe(3);
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(2);
});

test('discard unfinished drawing when leaving a page or disabling editing', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'FIT', '100%');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await clickPage(page, 400, 300);
	await expect(page.locator('.drawing-target')).toHaveCount(1);
	await page.getByRole('treeitem', { name: '02', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await clickPage(page, 400, 300);
	await selectMenu(page, 'EDIT: YES', 'No');
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await page.keyboard.press('Backspace');
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
});
