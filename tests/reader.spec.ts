import { test, expect, type Page } from '@playwright/test';

declare global {
	interface Window {
		__filesRead: string[];
		__releaseImage: () => void;
		__imageWaiting: boolean;
		__imageUrls: { created: string[]; revoked: string[] };
	}
}

async function readerImageCount(page: Page) {
	return page.evaluate(() => {
		const previews = new Set(
			Array.from(document.querySelectorAll<HTMLImageElement>('[aria-label="Album pages"] img')).map(
				(img) => img.src
			)
		);
		return window.__imageUrls.created.filter((url) => !previews.has(url)).length;
	});
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
		pageCount?: number;
		mixedSizes?: boolean;
		delayedImage?: string;
	} = {}
) {
	await page.addInitScript(
		({ shuffled, delayed, cancel, browserLanguages, pageCount, mixedSizes, delayedImage }) => {
			Object.defineProperty(navigator, 'languages', { value: browserLanguages ?? ['zz'] });
			window.__filesRead = [];
			window.__imageWaiting = false;
			const imageGate = new Promise<void>((resolve) => {
				window.__releaseImage = resolve;
			});
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
			for (let number = 3; number <= (pageCount ?? 2); number++) {
				const name = String(number).padStart(2, '0');
				contents[`album/${name}.png`] = svg;
				contents[`album/${name}.en.bbl`] = JSON.stringify({
					pages: [{ bubbles: [bubble(`Page ${number}`)] }]
				});
			}
			if (mixedSizes)
				contents['album/02.png'] = svg.replaceAll('800', '600').replaceAll('1000', '1200');

			function file(path: string) {
				return {
					kind: 'file',
					name: path.split('/').at(-1),
					path,
					async getFile() {
						if (path === delayedImage) {
							window.__imageWaiting = true;
							await imageGate;
						}
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
		},
		options
	);
}

async function openComic(page: Page, mode = '1P') {
	await page.goto('./');
	await page.getByRole('button', { name: 'Add folder' }).click();
	if (mode === '1P') await selectMenu(page, '2P', '1P');
	await page.getByRole('treeitem', { name: 'album' }).click();
	await page.getByRole('treeitem', { name: 'album' }).press('ArrowRight');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect(page.locator('svg image').first()).toBeVisible();
}

function layoutButton(page: Page, mode: string) {
	return page.getByRole('button', {
		name: mode === '1P' ? 'Single Page' : 'Side by Side',
		exact: true
	});
}

async function selectMenu(page: Page, name: string, option: string) {
	if (name === '1P' || name === '2P') {
		await layoutButton(page, option).click();
		await expect(layoutButton(page, option)).toHaveAttribute('aria-pressed', 'true');
		return;
	}
	if (name.startsWith('EDIT:') || name === 'BOX' || name === 'POLY') {
		const label = name.startsWith('EDIT:')
			? option === 'Yes'
				? 'Edit Mode'
				: 'Reading Mode'
			: option === 'Box'
				? 'Draw Boxes'
				: 'Draw Polygons';
		const button = page.getByRole('button', { name: label, exact: true });
		await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		return;
	}
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
	await expect(
		page.getByRole('menuitem', { name: 'EN', exact: true }).locator('img')
	).toBeVisible();
	await expect(page.getByText('Link 1', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Reading Mode', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('menuitem', { name: 'EN', exact: true }).press('ArrowDown');
	await expect(
		page.getByRole('menuitemradio', { name: 'NL', exact: true }).locator('img')
	).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menuitem', { name: 'EN', exact: true })).toBeFocused();
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
});

test('bubble visibility toggles in reading and edit modes and resets on reload', async ({
	page
}) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	const toggle = page.getByRole('button', { name: 'Show Translations', exact: true });
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('foreignObject, clipPath .bubble')).toHaveCount(0);
	await page.keyboard.press('b');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await page.getByRole('textbox').fill('Edited');
	await page.getByRole('textbox').press('End');
	await page.keyboard.press('b');
	await expect(page.getByRole('textbox')).toHaveText('Editedb');
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await toggle.click();
	await expect(page.getByRole('textbox')).toHaveCount(0);
	await expect(page.locator('main svg .bubble, main svg circle')).toHaveCount(0);
	// Hidden overlays must not let edit mode draw new invisible bubbles.
	const image = page.locator('svg[aria-label="Comic page"] > image').first();
	await image.click({ position: { x: 200, y: 200 } });
	await image.click({ position: { x: 250, y: 250 } });
	await page.keyboard.press('b');
	await expect(page.getByRole('textbox')).toHaveText('Editedb');
	await toggle.click();
	await page.reload();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('arrow keys navigate pages and stop at both ends', async ({ page }) => {
	await mockDirectory(page, { shuffled: true });
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await page.locator('main').click({ position: { x: 10, y: 400 } });
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('foreignObject')).toHaveText('Second page');
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('foreignObject')).toHaveText('Second page');
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await expect.poll(() => readerImageCount(page)).toBe(3);
});

for (const mode of ['1P', '2P']) {
	test(`Page Up/Down navigate app-wide in ${mode} with optional Shift`, async ({ page }) => {
		await mockDirectory(page, { pageCount: 6 });
		await openComic(page, mode);
		const treeItem = page.getByRole('treeitem', { name: /^0?1$/, exact: true });
		const leftPage = page.locator('[data-page-path]').first();
		const expectPage = async (number: number) => {
			await expect(leftPage).toHaveAttribute('data-page-path', `album/0${number}.png`);
		};
		const step = mode === '2P' ? 2 : 1;
		await expect(treeItem).toBeFocused();
		await page.keyboard.press('PageUp');
		await expectPage(1);
		await page.keyboard.press('PageDown');
		await expectPage(1 + step);
		await expect(treeItem).toBeFocused();
		await page.keyboard.press('Shift+PageDown');
		await expectPage(2 + step);
		await page.keyboard.press('Shift+PageUp');
		await expectPage(1 + step);
		await page.keyboard.press('PageUp');
		await expectPage(1);
		await expect(treeItem).toBeFocused();

		// Header controls also receive the shortcuts without transferring focus.
		const headerItem = layoutButton(page, mode);
		await headerItem.focus();
		await page.keyboard.press('PageDown');
		await expectPage(1 + step);
		await expect(headerItem).toBeFocused();
		await page.keyboard.press('PageUp');
		await expectPage(1);
		await page.keyboard.press('Control+PageDown');
		await expectPage(1);

		await selectMenu(page, 'ORG', 'EN');
		await selectMenu(page, 'EDIT: NO', 'Yes');
		await page.getByRole('textbox').first().focus();
		await page.keyboard.press('Shift+PageDown');
		await expectPage(2);

		await page.evaluate(() => document.documentElement.requestFullscreen());
		await expect(page.getByRole('tree')).toBeHidden();
		await page.keyboard.press('PageDown');
		await expectPage(2 + step);
		await page.keyboard.press('Shift+PageUp');
		await expectPage(1 + step);
	});
}

async function clickSpread(page: Page, fraction: number, shift = false) {
	const bounds = await page.locator('main svg[aria-label="Comic page"]').evaluateAll((pages) => {
		const boxes = pages.map((page) => page.getBoundingClientRect());
		return {
			left: Math.min(...boxes.map((box) => box.left)),
			right: Math.max(...boxes.map((box) => box.right)),
			top: Math.min(...boxes.map((box) => box.top))
		};
	});
	if (shift) await page.keyboard.down('Shift');
	await page.mouse.click(bounds.left + (bounds.right - bounds.left) * fraction, bounds.top + 40);
	if (shift) await page.keyboard.up('Shift');
}

for (const zoom of ['Fit', '50%']) {
	test(`click navigation uses page quarters and ignores surrounding space at ${zoom}`, async ({
		page
	}) => {
		await mockDirectory(page);
		await openComic(page);
		await selectMenu(page, 'ORG', 'EN');
		if (zoom !== 'Fit') await selectMenu(page, 'FIT', zoom);
		const texts = page.locator('foreignObject');
		const pane = page.locator('main');
		const paneBounds = (await pane.boundingBox())!;
		const image = page.getByRole('img', { name: 'Comic page' });
		const bounds = (await image.boundingBox())!;
		// The unused area to the right used to advance the page.
		await page.mouse.click(paneBounds.x + paneBounds.width - 10, bounds.y + 40);
		await expect(texts).toHaveText('Hello');
		if (zoom === '50%') {
			await page.mouse.click(bounds.x + bounds.width * 0.9, bounds.y + bounds.height + 20);
			await expect(texts).toHaveText('Hello');
		}
		await clickSpread(page, 0.1);
		await expect(texts).toHaveText('Hello');
		await clickSpread(page, 0.9);
		await expect(texts).toHaveText('Second page');
		for (const fraction of [0.3, 0.5, 0.7]) {
			await clickSpread(page, fraction);
			await expect(texts).toHaveText('Second page');
		}
		await clickSpread(page, 0.9);
		await expect(texts).toHaveText('Second page');
		await clickSpread(page, 0.1);
		await expect(texts).toHaveText('Hello');
		// A centered fullscreen page also leaves non-clickable margins.
		await page.evaluate(() => document.documentElement.requestFullscreen());
		await expect(page.getByRole('banner')).toBeHidden();
		await page.mouse.click(1430, 400);
		await expect(texts).toHaveText('Hello');
		await clickSpread(page, 0.9);
		await expect(texts).toHaveText('Second page');
	});
}

test('spread click zones exclude blank space below a shorter page', async ({ page }) => {
	await mockDirectory(page, { mixedSizes: true, pageCount: 4 });
	await openComic(page, '2P');
	await selectMenu(page, 'FIT', '50%');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	const images = page.getByRole('img', { name: 'Comic page' });
	const short = (await images.last().boundingBox())!;
	await page.mouse.click(short.x + short.width - 10, short.y + short.height + 20);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/02.png'
	);
	await clickSpread(page, 0.1);
	await clickSpread(page, 0.9);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/03.png'
	);
	// A click in the spread's middle half stays put even on the edge of one page.
	await clickSpread(page, 0.55);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/03.png'
	);
	await clickSpread(page, 0.1);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'album/01.png'
	);
});

test('navigation leaves editor clicks and text cursor keys available', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	const text = page.getByRole('textbox');
	await text.fill('Edited text');
	await text.press('ArrowRight');
	await text.press('ArrowLeft');
	await expect(text).toHaveText('Edited text');
	await clickPage(page, 600, 400);
	await expect(page.locator('.drawing-target')).toHaveCount(1);
	await expect(text).toHaveText('Edited text');
});

test('remember zoom across reloads before any album is opened', async ({ page }) => {
	await page.goto('./');
	await expect(page.getByRole('button', { name: 'Add folder' })).toBeVisible();
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
	const handle = page.locator('main circle').last();
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
test.beforeEach(async ({ page }) => {
	// Playwright otherwise resizes the emulated screen along with the viewport.
	// A real monitor keeps its dimensions when a normal browser window is resized.
	await page.addInitScript(() => {
		Object.defineProperty(screen, 'width', { configurable: true, value: 1920 });
		Object.defineProperty(screen, 'height', { configurable: true, value: 1200 });
	});
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
	await expect(page.locator('.svgcontent rect').last()).toHaveAttribute('width', '250');
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Convert to Poly', { exact: true }).click();
	await expect(page.locator('.svgcontent polygon')).toHaveCount(1);
	// Every background precedes every text overlay, and all edit handles stay on top.
	await expect
		.poll(() =>
			page
				.locator('.svgcontent')
				.evaluate((layer) => Array.from(layer.children, (element) => element.localName))
		)
		.toEqual(['rect', 'polygon', 'foreignObject', 'foreignObject', ...Array(6).fill('circle')]);
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Convert to Box', { exact: true }).click();
	await expect(page.locator('.svgcontent polygon')).toHaveCount(0);
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Delete', { exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(1);

	await selectMenu(page, 'BOX', 'Poly');
	await clickPage(page, 400, 300);
	await clickPage(page, 650, 300);
	await clickPage(page, 650, 450);
	await clickPage(page, 400, 300);
	await expect(page.locator('.svgcontent polygon')).toHaveCount(1);
	await expect(page.locator('.svgcontent polygon')).toHaveAttribute(
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
	const handle = await page.locator('main circle').last().boundingBox();
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
	await expect(page.getByRole('treeitem', { name: /^0?1$/, exact: true })).toHaveCount(1);
	await selectMenu(page, 'ORG', 'EN');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
});

test('a slow language load cannot overwrite the newer page selection', async ({ page }) => {
	await mockDirectory(page, { delayed: true });
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
	await expect.poll(() => page.evaluate(() => window.__filesRead)).toContain('album/01.en.bbl');
	await expect(page.locator('foreignObject')).toHaveText('Second page');
});

test('cancelling the directory picker leaves the initial view usable', async ({ page }) => {
	await mockDirectory(page, { cancel: true });
	await page.goto('./');
	await page.getByRole('button', { name: 'Add folder' }).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Add folder' })).toBeVisible();
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
	await expect.poll(() => readerImageCount(page)).toBe(1);
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(0);
	await selectMenu(page, 'ORG', 'EN');
	await expect(page.getByRole('textbox')).toHaveText('Retained edit');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText('Second page');
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(1);
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText('Retained edit');
	await expect.poll(() => readerImageCount(page)).toBe(3);
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(2);
});

test('discard unfinished drawing when leaving a page or disabling editing', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'FIT', '100%');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await clickPage(page, 400, 300);
	await expect(page.locator('.drawing-target')).toHaveCount(1);
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await clickPage(page, 400, 300);
	await selectMenu(page, 'EDIT: YES', 'No');
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await page.keyboard.press('Backspace');
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
});

test('2P defaults to a separated spread, fits mixed page sizes and remembers the left page', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 5, mixedSizes: true });
	await openComic(page, '2P');
	await expect(layoutButton(page, '2P')).toBeVisible();
	const images = page.getByRole('img', { name: 'Comic page' });
	await expect(images).toHaveCount(2);
	const viewport = page.locator('main .viewport');
	await expect(page.locator('.page-separator')).toHaveCount(1);
	await expect(page.locator('.page-separator')).toHaveCSS('background-color', 'rgb(179, 179, 179)');
	await page.addStyleTag({
		content: '.viewport::-webkit-scrollbar { width: 17px; height: 17px; }'
	});
	for (const size of [
		{ width: 1440, height: 900 },
		{ width: 1100, height: 1100 }
	]) {
		await page.setViewportSize(size);
		await expect
			.poll(async () => {
				const left = (await images.nth(0).boundingBox())!;
				const right = (await images.nth(1).boundingBox())!;
				return Math.abs(right.x - left.x - left.width - (2 * left.width) / 800);
			})
			.toBeLessThan(0.1);
		await expect
			.poll(() =>
				viewport.evaluate(
					(el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight
				)
			)
			.toBe(true);
		const left = (await images.nth(0).boundingBox())!;
		const right = (await images.nth(1).boundingBox())!;
		expect(left.width / left.height).toBeCloseTo(0.8, 4);
		expect(right.width / right.height).toBeCloseTo(0.5, 4);
		expect(left.width / 800).toBeCloseTo(right.width / 600, 4);
		await selectMenu(page, 'FIT', 'Width');
		await expect
			.poll(() =>
				viewport.evaluate((el) =>
					Math.abs(
						Array.from(el.querySelectorAll('svg, .page-separator')).reduce(
							(width, image) => width + image.getBoundingClientRect().width,
							0
						) - el.clientWidth
					)
				)
			)
			.toBeLessThan(1);
		await expect
			.poll(() =>
				viewport.evaluate(
					(el) =>
						el.scrollWidth <= el.clientWidth &&
						el.scrollHeight > el.clientHeight === (el.clientWidth * 1200) / 1402 > el.clientHeight
				)
			)
			.toBe(true);
		await selectMenu(page, 'WIDTH', 'Fit');
	}
	await page.screenshot({ path: test.info().outputPath('two-page-fit.png') });
	await selectMenu(page, 'FIT', '50%');
	await expect.poll(async () => (await images.nth(0).boundingBox())?.width).toBeCloseTo(400, 0);
	await expect.poll(async () => (await images.nth(1).boundingBox())?.width).toBeCloseTo(300, 0);
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await selectMenu(page, '2P', '1P');
	await expect(page.locator('[data-page-path]')).toHaveAttribute('data-page-path', 'album/02.png');
	await expect(page.locator('.page-separator')).toHaveCount(0);
	await page.reload();
	await expect(layoutButton(page, '1P')).toBeVisible();
});

for (const pageCount of [5, 6]) {
	test(`2P keyboard and mouse navigation with ${pageCount} pages and Shift steps`, async ({
		page
	}) => {
		await mockDirectory(page, { pageCount });
		await openComic(page, '2P');
		await selectMenu(page, 'ORG', 'EN');
		const texts = page.locator('foreignObject');
		await expect(texts).toHaveText(['Hello', 'Second page']);
		await clickSpread(page, 0.1);
		await page.keyboard.press('ArrowRight');
		await expect(texts).toHaveText(['Page 3', 'Page 4']);
		await page.keyboard.press('Shift+ArrowLeft');
		await expect(texts).toHaveText(['Second page', 'Page 3']);
		await clickSpread(page, 0.9, true);
		await expect(texts).toHaveText(['Page 3', 'Page 4']);
		await clickSpread(page, 0.1, true);
		await expect(texts).toHaveText(['Second page', 'Page 3']);
		await page.keyboard.press('Shift+ArrowRight');
		await expect(texts).toHaveText(['Page 3', 'Page 4']);
		await clickSpread(page, 0.9);
		await expect(texts).toHaveText(pageCount === 5 ? ['Page 5'] : ['Page 5', 'Page 6']);
		await page.keyboard.press('ArrowRight');
		await expect(texts).toHaveText(pageCount === 5 ? ['Page 5'] : ['Page 5', 'Page 6']);
		await clickSpread(page, 0.1);
		await expect(texts).toHaveText(['Page 3', 'Page 4']);
		await page.keyboard.press('ArrowLeft');
		await expect(texts).toHaveText(['Hello', 'Second page']);
		await page.keyboard.press('Shift+ArrowLeft');
		await expect(texts).toHaveText(['Hello', 'Second page']);
	});
}

test('edit both pages in 2P, target the right context menu and retain overlapping page state', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 5 });
	await openComic(page, '2P');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await page.getByRole('textbox').nth(0).fill('Left edit');
	await page.getByRole('textbox').nth(1).fill('Right edit');
	const rightPage = page.locator('[data-page-path="album/02.png"]');
	const image = rightPage.getByRole('img');
	const box = (await image.boundingBox())!;
	const handle = (await rightPage.locator('circle').last().boundingBox())!;
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		handle.x + handle.width / 2 + box.width / 10,
		handle.y + handle.height / 2 + box.height / 10
	);
	await page.mouse.up();
	// Pointer events round screen coordinates at fractional spread scales.
	await expect
		.poll(async () =>
			Math.abs(Number(await rightPage.locator('foreignObject').first().getAttribute('width')) - 300)
		)
		.toBeLessThan(800 / box.width);
	await expect
		.poll(async () =>
			Math.abs(
				Number(await rightPage.locator('foreignObject').first().getAttribute('height')) - 200
			)
		)
		.toBeLessThan(1000 / box.height);

	await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
	await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.45);
	await expect(rightPage.getByRole('textbox')).toHaveCount(2);
	await rightPage.getByRole('textbox').last().fill('New on right');
	await rightPage.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Convert to Poly', { exact: true }).click();
	await expect(rightPage.locator('.svgcontent polygon')).toHaveCount(1);
	await rightPage.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Delete', { exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText(['Left edit', 'Right edit']);
	// Navigation starts outside editable text; the retained right page becomes the left page.
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText(['Right edit', 'Page 3']);
	await expect.poll(() => readerImageCount(page)).toBe(3);
	await page.getByRole('textbox').first().click({ button: 'right' });
	await page.getByText('Delete', { exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText('Page 3');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText('Left edit');
	await page.screenshot({ path: test.info().outputPath('two-page-editor.png') });
});

test('keep the complete spread and zoom stable until both incoming pages are ready', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 5, delayedImage: 'album/04.png' });
	await openComic(page, '2P');
	await selectMenu(page, 'ORG', 'EN');
	await expect(page.locator('foreignObject')).toHaveText(['Hello', 'Second page']);
	const before = await page.locator('.scaled-content').boundingBox();
	await page.locator('main').click({ position: { x: 10, y: 400 } });
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => page.evaluate(() => window.__imageWaiting)).toBe(true);
	// Sample multiple rendered frames while the right-hand image is blocked.
	const frames = await page.evaluate(async () => {
		const samples = [];
		for (let i = 0; i < 6; i++) {
			await new Promise(requestAnimationFrame);
			const content = document.querySelector('.scaled-content')!.getBoundingClientRect();
			samples.push({
				texts: Array.from(document.querySelectorAll('foreignObject')).map((el) => el.textContent),
				width: content.width,
				height: content.height,
				loading: document.querySelector('main')!.textContent!.includes('Loading page...')
			});
		}
		return samples;
	});
	for (const sample of frames) {
		expect(sample.texts).toEqual(['Hello', 'Second page']);
		expect(sample.width).toBe(before!.width);
		expect(sample.height).toBe(before!.height);
		expect(sample.loading).toBe(false);
	}
	await page.evaluate(() => window.__releaseImage());
	await expect(page.locator('foreignObject')).toHaveText(['Page 3', 'Page 4']);
	await expect(page.locator('.scaled-content')).toHaveJSProperty('clientWidth', before!.width);
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(2);
});

test('a superseded slow spread cannot replace newer navigation and releases its images', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 5, delayedImage: 'album/04.png' });
	await openComic(page, '2P');
	await selectMenu(page, 'ORG', 'EN');
	await page.getByRole('treeitem', { name: /^0?3$/, exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__imageWaiting)).toBe(true);
	await page.getByRole('treeitem', { name: /^0?5$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText(['Page 5']);
	await page.evaluate(() => window.__releaseImage());
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(4);
	await expect(page.locator('foreignObject')).toHaveText(['Page 5']);
	await expect(page.locator('[data-page-path]')).toHaveAttribute('data-page-path', 'album/05.png');
});

test('fullscreen hides reader UI, fills the window, and restores editing and sidebar state', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 5 });
	await openComic(page, '2P');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await page.getByRole('textbox').first().fill('Fullscreen edit');
	const before = (await page.locator('main').boundingBox())!;
	expect(before).toEqual({ x: 256, y: 48, width: 1184, height: 1052 });
	await page.evaluate(() => document.documentElement.requestFullscreen());
	await expect(page.getByRole('banner')).toBeHidden();
	await expect(page.getByRole('tree')).toBeHidden();
	await expect(page.getByRole('textbox')).toHaveCount(0);
	await expect(page.locator('main circle')).toHaveCount(0);
	await expect
		.poll(() => page.locator('main').boundingBox())
		.toEqual({ x: 0, y: 0, width: 1440, height: 1100 });
	await expect(page.locator('foreignObject')).toHaveText(['Fullscreen edit', 'Second page']);
	await page.locator('main').click({ position: { x: 1430, y: 400 } });
	await expect(page.locator('foreignObject')).toHaveText(['Page 3', 'Page 4']);
	await page.keyboard.press('Shift+ArrowLeft');
	await expect(page.locator('foreignObject')).toHaveText(['Second page', 'Page 3']);
	await page.evaluate(() => document.exitFullscreen());
	await expect(page.getByRole('banner')).toBeVisible();
	await expect(page.getByRole('tree')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit Mode', exact: true })).toBeVisible();
	await expect.poll(() => page.locator('main').boundingBox()).toEqual(before);
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText(['Fullscreen edit', 'Second page']);
});

test('browser fullscreen geometry is detected on resize and normal maximization retains UI', async ({
	page
}) => {
	await mockDirectory(page);
	await openComic(page, '2P');
	// A maximized window still has browser chrome above the content.
	await page.evaluate(() => {
		Object.defineProperty(window, 'outerWidth', { configurable: true, value: screen.width });
		Object.defineProperty(window, 'outerHeight', { configurable: true, value: screen.height });
		window.dispatchEvent(new Event('resize'));
	});
	await expect(page.getByRole('banner')).toBeVisible();
	await page.evaluate(() => {
		Object.defineProperty(window, 'outerWidth', { configurable: true, value: innerWidth });
		Object.defineProperty(window, 'outerHeight', { configurable: true, value: innerHeight });
		Object.defineProperty(screen, 'width', { configurable: true, value: innerWidth });
		Object.defineProperty(screen, 'height', { configurable: true, value: innerHeight });
		window.dispatchEvent(new Event('resize'));
	});
	await expect(page.getByRole('banner')).toBeHidden();
	await expect(page.getByRole('tree')).toBeHidden();
	await expect
		.poll(() => page.locator('main').boundingBox())
		.toEqual({ x: 0, y: 0, width: 1440, height: 1100 });
	await page.evaluate(() => {
		Object.defineProperty(screen, 'height', { configurable: true, value: innerHeight + 100 });
		window.dispatchEvent(new Event('resize'));
	});
	await expect(page.getByRole('banner')).toBeVisible();
	await expect(page.getByRole('tree')).toBeVisible();
});

for (const mode of ['1P', '2P']) {
	test(`center ${mode} content in fullscreen and keep oversized pages scrollable`, async ({
		page
	}) => {
		await mockDirectory(page);
		await openComic(page, mode);
		let currentZoom = 'FIT';
		for (const zoom of ['Fit', '50%', 'Width', '200%']) {
			if (zoom.toUpperCase() !== currentZoom) await selectMenu(page, currentZoom, zoom);
			currentZoom = zoom.toUpperCase();
			await page.evaluate(() => document.documentElement.requestFullscreen());
			await expect(page.getByRole('banner')).toBeHidden();
			await expect(page.locator('.page-separator')).toHaveCount(mode === '2P' ? 1 : 0);
			await expect
				.poll(() =>
					page.locator('.viewport').evaluate((el) => {
						const viewport = el.getBoundingClientRect();
						const content = el.querySelector('.scaled-content')!.getBoundingClientRect();
						return Math.max(
							Math.abs(
								content.left - viewport.left - Math.max(0, (el.clientWidth - content.width) / 2)
							),
							Math.abs(
								content.top - viewport.top - Math.max(0, (el.clientHeight - content.height) / 2)
							)
						);
					})
				)
				.toBeLessThan(1);
			if (zoom === '200%') {
				await expect
					.poll(() =>
						page.locator('.viewport').evaluate((el) => {
							el.scrollLeft = el.scrollWidth;
							el.scrollTop = el.scrollHeight;
							const viewport = el.getBoundingClientRect();
							const content = el.querySelector('.scaled-content')!.getBoundingClientRect();
							return Math.max(
								Math.abs(content.right - viewport.left - el.clientWidth),
								Math.abs(content.bottom - viewport.top - el.clientHeight)
							);
						})
					)
					.toBeLessThan(1);
			}
			await page.evaluate(() => document.exitFullscreen());
			await expect(page.getByRole('banner')).toBeVisible();
			await expect(page.locator('.viewport')).not.toHaveClass(/centered/);
		}
	});
}

for (const mode of ['1P', '2P']) {
	test(`wheel navigation in Fit respects ${mode} steps, Shift, gesture bursts and fullscreen`, async ({
		page
	}) => {
		await mockDirectory(page, { pageCount: 6 });
		await openComic(page, mode);
		// Keep burst timing independent of image loading and CI scheduling.
		const time = new Date('2026-10-20T12:00:00Z');
		await page.clock.install({ time });
		await page.clock.pauseAt(time);
		const paths = () =>
			page
				.locator('[data-page-path]')
				.evaluateAll((els) => els.map((el) => el.getAttribute('data-page-path')));
		const start = mode === '1P' ? ['album/01.png'] : ['album/01.png', 'album/02.png'];
		const next = mode === '1P' ? ['album/02.png'] : ['album/03.png', 'album/04.png'];
		await page.mouse.move(800, 400);
		await page.mouse.wheel(0, 120);
		await expect.poll(paths).toEqual(next);
		// Momentum from the same gesture must not turn additional pages.
		const prevented = await page.locator('.viewport').evaluate((el) => {
			return Array.from(
				{ length: 8 },
				() =>
					!el.dispatchEvent(
						new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true })
					)
			);
		});
		expect(prevented.every(Boolean)).toBe(true);
		await expect.poll(paths).toEqual(next);
		await page.mouse.wheel(0, -120);
		await expect.poll(paths).toEqual(start);
		await page.keyboard.down('Shift');
		await page.mouse.wheel(0, 120);
		await page.keyboard.up('Shift');
		await expect
			.poll(paths)
			.toEqual(mode === '1P' ? ['album/02.png'] : ['album/02.png', 'album/03.png']);
		await page.evaluate(() => document.documentElement.requestFullscreen());
		await expect(page.getByRole('banner')).toBeHidden();
		// Wait for the fullscreen viewport to settle before sending native input.
		await page.locator('.viewport').hover();
		await page.mouse.wheel(0, -120);
		await expect.poll(paths).toEqual(start);
		await page.evaluate(() => document.exitFullscreen());
	});
}

test('wheel leaves other zoom modes, editor controls, browser zoom and sidebar alone', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 6 });
	await openComic(page, '2P');
	const active = page.getByRole('treeitem', { name: /^0?1$/, exact: true });
	const wheel = (
		selector: string,
		options: Pick<WheelEventInit, 'deltaX' | 'deltaY' | 'ctrlKey'> = {}
	) =>
		page
			.locator(selector)
			.first()
			.evaluate(
				(el, options) =>
					!el.dispatchEvent(
						new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true, ...options })
					),
				options
			);
	expect(await wheel('.tree')).toBe(false);
	expect(await wheel('.viewport', { ctrlKey: true })).toBe(false);
	expect(await wheel('.viewport', { deltaX: 120, deltaY: 0 })).toBe(false);
	await expect(active).toHaveClass(/--active/);
	await selectMenu(page, 'FIT', 'Width');
	expect(await wheel('.viewport')).toBe(false);
	await expect(active).toHaveClass(/--active/);
	await selectMenu(page, 'WIDTH', '200%');
	expect(await wheel('.viewport')).toBe(false);
	await expect(active).toHaveClass(/--active/);
	await selectMenu(page, '200%', 'Fit');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	expect(await wheel('[contenteditable]')).toBe(false);
	expect(await wheel('.viewport')).toBe(false);
	await expect(active).toHaveClass(/--active/);
});

test('sustained wheel scrolling advances at a bounded rate without requiring a pause', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 10 });
	await openComic(page, '2P');
	const time = new Date('2026-10-20T12:00:00Z');
	await page.clock.install({ time });
	await page.clock.pauseAt(time);
	const wheel = (deltaY = 120) =>
		page.locator('.viewport').dispatchEvent('wheel', { deltaY, bubbles: true, cancelable: true });
	const left = () => page.locator('[data-page-path]').first().getAttribute('data-page-path');
	await wheel();
	await expect.poll(left).toBe('album/03.png');
	for (let step = 1; step <= 4; step++) {
		await page.clock.runFor(50);
		await wheel();
		await expect
			.poll(left)
			.toBe(step < 2 ? 'album/03.png' : step < 4 ? 'album/05.png' : 'album/07.png');
	}
	// Reversals and separate gestures stay responsive even within the rate limit.
	await wheel(-120);
	await expect.poll(left).toBe('album/05.png');
	await page.clock.runFor(260);
	await wheel(-120);
	await expect.poll(left).toBe('album/03.png');
});

test('1/s and 2/d switch page layout, retain the left page and work in fullscreen', async ({
	page
}) => {
	await mockDirectory(page, { pageCount: 5 });
	await openComic(page, '2P');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await page.locator('main').click({ position: { x: 600, y: 400 } });
	for (const [key, mode] of [
		['1', '1P'],
		['2', '2P'],
		['s', '1P'],
		['d', '2P']
	]) {
		await page.keyboard.press(key);
		await expect(layoutButton(page, mode)).toBeVisible();
		await expect(page.locator('[data-page-path]')).toHaveCount(mode === '1P' ? 1 : 2);
		await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
			'data-page-path',
			'album/02.png'
		);
	}
	await page.evaluate(() => document.documentElement.requestFullscreen());
	await expect(page.getByRole('banner')).toBeHidden();
	await page.keyboard.press('s');
	await expect(page.locator('[data-page-path]')).toHaveCount(1);
	await page.keyboard.press('d');
	await expect(page.locator('[data-page-path]')).toHaveCount(2);
	await page.keyboard.press('1');
	await expect(page.locator('[data-page-path]')).toHaveCount(1);
	await expect(page.locator('[data-page-path]')).toHaveAttribute('data-page-path', 'album/02.png');
	await page.evaluate(() => document.exitFullscreen());
	await expect(layoutButton(page, '1P')).toBeVisible();
	await page.reload();
	await expect(layoutButton(page, '1P')).toBeVisible();
});

test('page layout shortcuts leave text editing, modified keys and composition alone', async ({
	page
}) => {
	await mockDirectory(page);
	await openComic(page, '2P');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	const text = page.getByRole('textbox').first();
	await text.fill('');
	await text.pressSequentially('12sd');
	await expect(text).toHaveText('12sd');
	await expect(layoutButton(page, '2P')).toBeVisible();
	for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
		const prevented = await page.evaluate(
			(modifier) =>
				!window.dispatchEvent(
					new KeyboardEvent('keydown', { key: 's', cancelable: true, [modifier]: true })
				),
			modifier
		);
		expect(prevented).toBe(false);
		await expect(layoutButton(page, '2P')).toBeVisible();
	}
});
