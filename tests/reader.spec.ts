import { test, expect, type Page } from '@playwright/test';

declare global {
	interface Window {
		__filesRead: string[];
		__releaseImage: () => void;
		__imageWaiting: boolean;
		__imageUrls: { created: string[]; revoked: string[] };
	}
}

async function expectPagePaths(page: Page, paths: string[]) {
	await expect
		.poll(() =>
			page
				.locator('[data-page-path]')
				.evaluateAll((elements) =>
					elements.map((element) => element.getAttribute('data-page-path'))
				)
		)
		.toEqual(paths);
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
		overlays?: 'none' | 'ocr' | 'mrg';
		overlayLanguage?: string;
		delayedImage?: string;
		renderedImages?: boolean;
		legacyPolygons?: boolean;
		overlappingPolygon?: boolean;
	} = {}
) {
	await page.addInitScript(
		({
			shuffled,
			delayed,
			cancel,
			browserLanguages,
			pageCount,
			mixedSizes,
			delayedImage,
			overlays,
			overlayLanguage,
			renderedImages,
			legacyPolygons,
			overlappingPolygon
		}) => {
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
			const polygon = (text: string, x1: number, y1: number, x2: number, y2: number) => ({
				text,
				shape: {
					type: 'poly',
					vs: [
						{ x: x1, y: y1 },
						{ x: x2, y: y1 },
						{ x: x2, y: y2 },
						{ x: x1, y: y2 }
					]
				}
			});
			if (legacyPolygons)
				contents['album/02.en.bbl'] = JSON.stringify({
					pages: [{ bubbles: [polygon('Second page', 80, 80, 300, 180)] }]
				});
			if (overlappingPolygon)
				contents['album/01.en.bbl'] = JSON.stringify({
					pages: [{ bubbles: [bubble('Hello'), polygon('Old polygon', 300, 180, 400, 300)] }]
				});
			if (renderedImages) {
				contents['album/01.en.jpg'] = svg.replace('Original', 'Rendered English');
				contents['album/01.fr.webp'] = svg.replace('Original', 'Rendered French');
			}
			for (let number = 3; number <= (pageCount ?? 2); number++) {
				const name = String(number).padStart(2, '0');
				contents[`album/${name}.png`] = svg;
				contents[`album/${name}.en.bbl`] = JSON.stringify({
					pages: [{ bubbles: [bubble(`Page ${number}`)] }]
				});
			}
			if (mixedSizes)
				contents['album/02.png'] = svg.replaceAll('800', '600').replaceAll('1000', '1200');

			if (overlays) {
				for (const name of Object.keys(contents)) if (name.endsWith('.bbl')) delete contents[name];
				if (overlays === 'ocr' || overlays === 'mrg')
					contents[`album/01.${overlays.toUpperCase()}.bbl`] = JSON.stringify({
						lang: overlayLanguage,
						pages: [{ bubbles: [bubble(`Old ${overlays.toUpperCase()}`)] }]
					});
			}

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
							type: /\.(png|jpg|webp)$/.test(path) ? 'image/svg+xml' : 'application/json'
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
	await page
		.getByRole('menu', { name, exact: true })
		.getByText(
			({ EN: 'English (EN)', NL: 'Dutch (NL)', FR: 'French (FR)' } as Record<string, string>)[
				option
			] ?? option,
			{ exact: true }
		)
		.click();
	const newName = name.startsWith('EDIT:') ? 'EDIT: ' + option.toUpperCase() : option.toUpperCase();
	await expect(page.getByRole('menuitem', { name: newName, exact: true })).toBeVisible();
	if (await page.getByRole('menu', { name: newName, exact: true }).isVisible()) {
		await page.getByRole('menuitem', { name: newName, exact: true }).click();
	}
}

test('reader uses rendered language images and falls back per page; editing uses original overlays', async ({
	page
}) => {
	await mockDirectory(page, { renderedImages: true });
	await openComic(page);
	const image = page.locator('[data-page-path="album/01.png"] svg image').first();
	const original = await image.getAttribute('href');
	await page.getByRole('menuitem', { name: 'ORG', exact: true }).click();
	for (const language of ['English (EN)', 'French (FR)', 'Dutch (NL)']) {
		await expect(page.getByRole('menuitemradio', { name: language, exact: true })).toHaveCount(1);
	}
	await page.getByRole('menuitemradio', { name: 'English (EN)', exact: true }).click();
	await expect(image).not.toHaveAttribute('href', original!);
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await expect(page.getByRole('region', { name: 'Album pages' }).getByRole('button')).toHaveCount(
		2
	);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	expect(await page.evaluate(() => window.__filesRead.at(-1))).not.toBe('album/01.en.jpg');
	const editImage = page.locator('[data-page-path="album/01.png"] svg image').first();
	await expect
		.poll(async () =>
			page.evaluate(
				async (url) => await (await fetch(url!)).text(),
				await editImage.getAttribute('href')
			)
		)
		.toContain('Original');
	await expect(page.getByRole('button', { name: 'Render Page', exact: true })).toBeEnabled();
	await expect(
		page
			.getByRole('button', { name: 'Render Page', exact: true })
			.locator('[data-toolbar-icon="paint-roller"]')
	).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Draw Boxes', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByRole('button', { name: 'Draw Polygons', exact: true })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await page.getByRole('button', { name: 'Reading Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await selectMenu(page, 'EN', 'FR');
	await expect
		.poll(async () =>
			page.evaluate(
				async (url) => await (await fetch(url!)).text(),
				await image.getAttribute('href')
			)
		)
		.toContain('Rendered French');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await expect
		.poll(async () =>
			page.evaluate(
				async (url) => await (await fetch(url!)).text(),
				await page.locator('svg image').first().getAttribute('href')
			)
		)
		.toContain('Original');
	await selectMenu(page, 'FR', 'ORG');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect
		.poll(async () =>
			page.evaluate(
				async (url) => await (await fetch(url!)).text(),
				await image.getAttribute('href')
			)
		)
		.toContain('Original');
});

test('R and E switch reader modes from the tree and toolbar without intercepting text entry', async ({
	page
}) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	const reading = page.getByRole('button', { name: 'Reading Mode', exact: true });
	const editing = page.getByRole('button', { name: 'Edit Mode', exact: true });
	await expect(reading).toHaveAttribute('title', 'Reading Mode (R)');
	await expect(editing).toHaveAttribute('title', 'Edit Mode (E)');
	await expect(reading).toHaveAttribute('aria-keyshortcuts', 'r');
	await expect(editing).toHaveAttribute('aria-keyshortcuts', 'e');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).focus();
	await page.keyboard.press('e');
	await expect(editing).toHaveAttribute('aria-pressed', 'true');
	const textbox = page.getByRole('textbox');
	await textbox.fill('Text');
	await textbox.press('End');
	await page.keyboard.type('re');
	await expect(textbox).toHaveText('Textre');
	await expect(editing).toHaveAttribute('aria-pressed', 'true');
	await editing.focus();
	await page.keyboard.press('r');
	await expect(reading).toHaveAttribute('aria-pressed', 'true');
	await expect(textbox).toHaveCount(0);
	await page.keyboard.press('Control+e');
	await expect(reading).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Shift+E');
	await expect(editing).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Shift+R');
	await expect(reading).toHaveAttribute('aria-pressed', 'true');
});

test('bubble visibility toggles in edit mode and resets on reload', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
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
	await expectPagePaths(page, ['album/01.png']);
	await page.keyboard.press('ArrowRight');
	await expectPagePaths(page, ['album/02.png']);
	await page.keyboard.press('ArrowRight');
	await expectPagePaths(page, ['album/02.png']);
	await page.keyboard.press('ArrowLeft');
	await expectPagePaths(page, ['album/01.png']);
	await expect.poll(() => readerImageCount(page)).toBe(3);
});

for (const mode of ['1P', '2P']) {
	test(`toolbar page navigation follows ${mode} and disables at boundaries`, async ({ page }) => {
		await mockDirectory(page, { pageCount: 5 });
		await openComic(page, mode);
		const navigation = page.getByRole('group', { name: 'Page navigation', exact: true });
		const previous = navigation.getByRole('button', { name: 'Previous Page', exact: true });
		const next = navigation.getByRole('button', { name: 'Next Page', exact: true });
		await expect(previous).toHaveAttribute('title', 'Previous Page (Pg Up)');
		await expect(next).toHaveAttribute('title', 'Next Page (Pg Dn)');
		await expect(previous.locator('[data-toolbar-icon="caret-left"]')).toBeVisible();
		await expect(next.locator('[data-toolbar-icon="caret-right"]')).toBeVisible();
		await expect(previous).toBeDisabled();
		const step = mode === '2P' ? 2 : 1;
		const leftPage = page.locator('[data-page-path]').first();
		await next.click();
		await expect(leftPage).toHaveAttribute('data-page-path', `album/0${1 + step}.png`);
		await previous.click();
		await expect(leftPage).toHaveAttribute('data-page-path', 'album/01.png');
		for (let number = 1 + step; number <= 5; number += step) await next.click();
		await expect(leftPage).toHaveAttribute('data-page-path', 'album/05.png');
		await expect(next).toBeDisabled();
	});

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
		const pane = page.locator('main');
		const paneBounds = (await pane.boundingBox())!;
		const image = page.getByRole('img', { name: 'Comic page' });
		const bounds = (await image.boundingBox())!;
		// The unused area to the right used to advance the page.
		await page.mouse.click(paneBounds.x + paneBounds.width - 10, bounds.y + 40);
		await expectPagePaths(page, ['album/01.png']);
		if (zoom === '50%') {
			await page.mouse.click(bounds.x + bounds.width * 0.9, bounds.y + bounds.height + 20);
			await expectPagePaths(page, ['album/01.png']);
		}
		await clickSpread(page, 0.1);
		await expectPagePaths(page, ['album/01.png']);
		await clickSpread(page, 0.9);
		await expectPagePaths(page, ['album/02.png']);
		for (const fraction of [0.3, 0.5, 0.7]) {
			await clickSpread(page, fraction);
			await expectPagePaths(page, ['album/02.png']);
		}
		await clickSpread(page, 0.9);
		await expectPagePaths(page, ['album/02.png']);
		await clickSpread(page, 0.1);
		await expectPagePaths(page, ['album/01.png']);
		// A centered fullscreen page also leaves non-clickable margins.
		await page.evaluate(() => document.documentElement.requestFullscreen());
		await expect(page.getByRole('banner')).toBeHidden();
		await page.mouse.click(1430, 400);
		await expectPagePaths(page, ['album/01.png']);
		await clickSpread(page, 0.9);
		await expectPagePaths(page, ['album/02.png']);
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
	await expect(page.locator('.drawing-target')).toHaveCount(0);
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
	await page.getByRole('menuitemradio', { name: 'Dutch (NL)', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await expect(page.getByRole('menuitem', { name: 'NL', exact: true })).toBeVisible();
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

async function dragPage(page: Page, x1: number, y1: number, x2: number, y2: number) {
	const start = await pagePoint(page, x1, y1);
	const end = await pagePoint(page, x2, y2);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 5 });
	await page.mouse.up();
}

test('draw, edit, convert and delete box and polygon bubbles', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'FIT', '100%');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await dragPage(page, 400, 300, 650, 420);
	await expect(page.locator('foreignObject')).toHaveCount(2);
	await page.getByRole('textbox').last().fill('New bubble');
	await expect(page.locator('.svgcontent rect').last()).toHaveAttribute('width', '250');
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Convert to Poly', { exact: true }).click();
	await expect(page.locator('.svgcontent polygon')).toHaveCount(1);
	// Each bubble stacks its shape and text together; edit handles stay above all bubbles.
	await expect
		.poll(() =>
			page
				.locator('.svgcontent')
				.evaluate((layer) => Array.from(layer.children, (element) => element.localName))
		)
		.toEqual(['rect', 'foreignObject', 'polygon', 'foreignObject', ...Array(6).fill('circle')]);
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Convert to Box', { exact: true }).click();
	await expect(page.locator('.svgcontent polygon')).toHaveCount(0);
	await page.getByRole('textbox').last().click({ button: 'right' });
	await page.getByText('Delete', { exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(1);

	await selectMenu(page, 'BOX', 'Poly');
	await dragPage(page, 400, 300, 650, 300);
	await clickPage(page, 650, 450);
	await clickPage(page, 400, 300);
	await expect(page.locator('.svgcontent polygon')).toHaveCount(1);
	await expect(page.locator('.svgcontent polygon')).toHaveAttribute(
		'points',
		'400,300 650,300 650,450'
	);
	await selectMenu(page, 'POLY', 'Box');
	await dragPage(page, 400, 500, 650, 600);
	await expect(page.locator('.svgcontent rect')).toHaveCount(2);
	await expect(page.locator('.svgcontent polygon')).toHaveCount(1);
	await page.screenshot({ path: test.info().outputPath('editor.png') });
});

test('delete a polygon point on the right page while keeping at least three vertices', async ({
	page
}) => {
	const contextMenu = page.locator('ul.bx--menu--root');
	async function closeContextMenu() {
		// Carbon registers dismissal on the next task; Escape can arrive before it is ready.
		await expect(async () => {
			await page.keyboard.press('Escape');
			await expect(contextMenu).not.toBeVisible();
		}).toPass();
	}
	await mockDirectory(page, { legacyPolygons: true });
	await openComic(page, '2P');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	const leftPage = page.locator('[data-page-path="album/01.png"]');
	const rightPage = page.locator('[data-page-path="album/02.png"]');
	await expect(rightPage.locator('circle')).toHaveCount(4);

	// A text menu must not inherit a previously targeted vertex.
	await rightPage.locator('circle[data-point-index="0"]').click({ button: 'right' });
	await expect(page.getByText('Delete point', { exact: true })).toBeVisible();
	await closeContextMenu();
	await rightPage.getByRole('textbox').click({ button: 'right' });
	await expect(contextMenu).toBeVisible();
	await expect(page.getByText('Delete point', { exact: true })).toHaveCount(0);
	await closeContextMenu();

	await rightPage.locator('circle[data-point-index="1"]').click({ button: 'right' });
	await page.getByText('Delete point', { exact: true }).click();
	await expect(rightPage.locator('.svgcontent polygon')).toHaveAttribute(
		'points',
		'80,80 300,180 80,180'
	);
	await expect(rightPage.locator('circle')).toHaveCount(3);
	await expect(rightPage.getByRole('textbox')).toHaveText('Second page');
	await expect(leftPage.locator('circle')).toHaveCount(2);
	await expect(leftPage.getByRole('textbox')).toHaveText('Hello');

	await rightPage.locator('circle[data-point-index="1"]').click({ button: 'right' });
	await expect(contextMenu).toBeVisible();
	await expect(page.getByText('Delete point', { exact: true })).toHaveCount(0);
	await closeContextMenu();
	// Mock directory handles cannot be backed up; dismiss their notices before targeting this corner.
	for (const name of ['Dismiss storage notification', 'Dismiss backup notification']) {
		const dismiss = page.getByRole('button', { name, exact: true });
		if (await dismiss.isVisible()) await dismiss.click();
	}
	await leftPage.locator('circle').first().click({ button: 'right' });
	await expect(contextMenu).toBeVisible();
	await expect(page.getByText('Delete point', { exact: true })).toHaveCount(0);
	await closeContextMenu();

	// Remaining handles still refer to the correct vertices after removing a middle point.
	const handle = await rightPage.locator('circle[data-point-index="1"]').boundingBox();
	if (!handle) throw new Error('Missing polygon handle');
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2 + 20, handle.y + handle.height / 2 + 20);
	await page.mouse.up();
	const points = await rightPage.locator('.svgcontent polygon').getAttribute('points');
	expect(points).not.toBe('80,80 300,180 80,180');
	expect(points?.split(' ')[0]).toBe('80,80');
	expect(points?.split(' ')[2]).toBe('80,180');
	await selectMenu(page, 'EN', 'NL');
	await selectMenu(page, 'NL', 'EN');
	await expect(rightPage.locator('.svgcontent polygon')).toHaveAttribute('points', points!);
});

test('focus and handle presses raise the active shape, editor and highlighted handles', async ({
	page
}) => {
	await mockDirectory(page, { overlappingPolygon: true });
	await openComic(page);
	await selectMenu(page, 'FIT', '100%');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	// A legacy polygon shares a corner with the first bubble.
	const handles = page.locator('.svgcontent circle');
	const activeHandles = page.locator('.svgcontent circle.active');
	const box = page.locator('foreignObject[data-bubble-index="0"]');
	const poly = page.locator('foreignObject[data-bubble-index="1"]');
	await expect(handles).toHaveCount(6);

	await box.getByRole('textbox').focus();
	await expect(box.getByRole('textbox')).toBeFocused();
	await expect(page.locator('foreignObject').last()).toHaveAttribute('data-bubble-index', '0');
	await expect
		.poll(() => page.locator('.svgcontent').evaluate((layer) => layer.children[2].localName))
		.toBe('rect');
	await expect(activeHandles).toHaveCount(2);
	await expect(handles.nth(4)).toHaveAttribute('class', /active/);
	await expect(handles.nth(5)).toHaveAttribute('class', /active/);
	await expect(activeHandles.first()).toHaveCSS('fill', 'rgb(15, 98, 254)');

	// Hit testing at the shared corner must choose the raised box handle.
	const shared = await pagePoint(page, 300, 180);
	const moved = await pagePoint(page, 320, 200);
	await page.mouse.move(shared.x, shared.y);
	await page.mouse.down();
	await page.mouse.move(moved.x, moved.y, { steps: 5 });
	await page.mouse.up();
	await expect(box).toHaveAttribute('width', '240');
	await expect(poly).toHaveAttribute('width', '100');

	// Pressing a different shape's handle activates its whole set immediately,
	// and moving its DOM nodes to the front must not interrupt the drag.
	const corner = await pagePoint(page, 400, 300);
	const destination = await pagePoint(page, 420, 320);
	await page.mouse.move(corner.x, corner.y);
	await page.mouse.down();
	await expect(page.locator('foreignObject').last()).toHaveAttribute('data-bubble-index', '1');
	await expect
		.poll(() => page.locator('.svgcontent').evaluate((layer) => layer.children[2].localName))
		.toBe('polygon');
	await expect(activeHandles).toHaveCount(4);
	await expect(handles.nth(0)).not.toHaveAttribute('class', /active/);
	await expect(handles.nth(1)).not.toHaveAttribute('class', /active/);
	for (let index = 2; index < 6; index++) {
		await expect(handles.nth(index)).toHaveAttribute('class', /active/);
		await expect(handles.nth(index)).toHaveCSS('fill', 'rgb(15, 98, 254)');
	}
	await page.mouse.move(destination.x, destination.y, { steps: 5 });
	await page.mouse.up();
	await expect(poly).toHaveAttribute('width', '120');
	await expect(poly).toHaveAttribute('height', '140');
	await expect(box).toHaveText('Hello');

	await box.getByRole('textbox').focus();
	await expect(activeHandles).toHaveCount(2);
	await page.keyboard.press('End');
	await page.keyboard.insertText('!');
	await expect(box).toHaveText('Hello!');
	await poly.getByRole('textbox').focus();
	await expect(activeHandles).toHaveCount(4);
	await expect(poly.getByRole('textbox')).toBeFocused();

	await box.getByRole('textbox').click();
	await box.getByRole('textbox').click();
	await expect(activeHandles).toHaveCount(2);
	await expect(box.getByRole('textbox')).toBeFocused();
	await clickPage(page, 700, 700);
	await expect(activeHandles).toHaveCount(0);
	await expect(box.getByRole('textbox')).not.toBeFocused();
	await expect(box).toHaveText('Hello!');
	await expect(page.locator('foreignObject').last()).toHaveAttribute('data-bubble-index', '1');
	await expect(handles.first()).toHaveCSS('opacity', '0.2');
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await expect(page.locator('foreignObject')).toHaveCount(2);
	await box.getByRole('textbox').click();
	await expect(activeHandles).toHaveCount(2);
	await expect(box.getByRole('textbox')).toBeFocused();
});

test('clicking another page or the toolbar leaves the previous bubble editor', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page, '2P');
	await selectMenu(page, 'ORG', 'EN');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	const leftPage = page.locator('[data-page-path="album/01.png"]');
	const rightPage = page.locator('[data-page-path="album/02.png"]');
	const leftText = leftPage.getByRole('textbox');
	const rightText = rightPage.getByRole('textbox');
	await leftText.click();
	await expect(leftPage.locator('circle.active')).toHaveCount(2);
	await rightText.click();
	await expect(leftPage.locator('circle.active')).toHaveCount(0);
	await expect(leftText).not.toBeFocused();
	await expect(rightText).toBeFocused();
	await expect(rightPage.locator('circle.active')).toHaveCount(2);
	await rightPage.locator('circle').first().click();
	await expect(rightPage.locator('circle.active')).toHaveCount(2);
	await expect(rightText).not.toBeFocused();
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await expect(page.locator('circle.active')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await rightText.click();
	await page.keyboard.press('End');
	await page.keyboard.insertText('!');
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await expect(rightText).not.toBeFocused();
	await expect(page.locator('circle.active')).toHaveCount(0);
	await expect(rightText).toHaveText('Second page!');
});

for (const tool of ['Box', 'Poly']) {
	for (const zoom of ['50%', '100%']) {
		test(`${tool} requires a deliberate drag at ${zoom} zoom`, async ({ page }) => {
			await mockDirectory(page);
			await openComic(page);
			await selectMenu(page, 'FIT', zoom);
			await selectMenu(page, 'EDIT: NO', 'Yes');
			if (tool === 'Poly') await selectMenu(page, 'BOX', 'Poly');
			const origin = await pagePoint(page, 400, 300);
			await page.mouse.click(origin.x, origin.y);
			await page.mouse.move(origin.x + 40, origin.y + 40);
			await expect(page.locator('.drawing-target')).toHaveCount(0);
			await expect(page.locator('foreignObject')).toHaveCount(0);

			await page.mouse.move(origin.x, origin.y);
			await page.mouse.down();
			await page.mouse.move(origin.x + 4, origin.y + 4);
			await expect(page.locator('.drawing-target')).toHaveCount(0);
			await page.mouse.up();
			await page.mouse.move(origin.x + 40, origin.y + 40);
			await expect(page.locator('.drawing-target')).toHaveCount(0);
			await expect(page.locator('foreignObject')).toHaveCount(0);

			await page.mouse.move(origin.x, origin.y);
			await page.mouse.down();
			await page.mouse.move(origin.x + 20, origin.y + 20);
			await expect(page.locator('.drawing-target')).toHaveCount(1);
			await page.keyboard.press('Escape');
			await page.mouse.up();
			await expect(page.locator('.drawing-target')).toHaveCount(0);
			await expect(page.locator('foreignObject')).toHaveCount(0);

			await page.mouse.move(origin.x, origin.y);
			await page.mouse.down();
			await page.mouse.move(origin.x + 20, origin.y + 20);
			await expect(page.locator('.drawing-target')).toHaveCount(1);
			await expect(page.locator('foreignObject')).toHaveCount(0);
			await page.mouse.up();
			if (tool === 'Poly') {
				await expect(page.locator('.drawing-target')).toHaveCount(1);
				await expect(page.locator('foreignObject')).toHaveCount(0);
				await page.mouse.click(origin.x + 20, origin.y + 40);
				await page.mouse.click(origin.x, origin.y);
			}
			await expect(page.locator('.drawing-target')).toHaveCount(0);
			await expect(page.locator('foreignObject')).toHaveCount(1);
		});
	}
}

test('cancel box drawing with Escape and reject a tiny box', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'FIT', '100%');
	await selectMenu(page, 'EDIT: NO', 'Yes');
	const start = await pagePoint(page, 400, 300);
	const end = await pagePoint(page, 600, 400);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y);
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await dragPage(page, 400, 300, 420, 305);
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await dragPage(page, 400, 300, 600, 400);
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
	await selectMenu(page, 'EDIT: NO', 'Yes');
	await expect(page.getByRole('treeitem', { name: /^0?1$/, exact: true })).toHaveCount(1);
	await selectMenu(page, 'ORG', 'EN');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
});

test('a slow language load cannot overwrite the newer page selection', async ({ page }) => {
	await mockDirectory(page, { delayed: true });
	await openComic(page);
	await selectMenu(page, 'EDIT: NO', 'Yes');
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
	await page.mouse.move((await pagePoint(page, 400, 300)).x, (await pagePoint(page, 400, 300)).y);
	await page.mouse.down();
	await page.mouse.move((await pagePoint(page, 600, 400)).x, (await pagePoint(page, 600, 400)).y);
	await expect(page.locator('.drawing-target')).toHaveCount(1);
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' })).toBeVisible();
	await page.mouse.up();
	await expect(page.locator('.drawing-target')).toHaveCount(0);
	await page.mouse.move((await pagePoint(page, 400, 300)).x, (await pagePoint(page, 400, 300)).y);
	await page.mouse.down();
	await page.mouse.move((await pagePoint(page, 600, 400)).x, (await pagePoint(page, 600, 400)).y);
	await selectMenu(page, 'EDIT: YES', 'No');
	await page.mouse.up();
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
		await expectPagePaths(page, ['album/01.png', 'album/02.png']);
		await clickSpread(page, 0.1);
		await page.keyboard.press('ArrowRight');
		await expectPagePaths(page, ['album/03.png', 'album/04.png']);
		await page.keyboard.press('Shift+ArrowLeft');
		await expectPagePaths(page, ['album/02.png', 'album/03.png']);
		await clickSpread(page, 0.9, true);
		await expectPagePaths(page, ['album/03.png', 'album/04.png']);
		await clickSpread(page, 0.1, true);
		await expectPagePaths(page, ['album/02.png', 'album/03.png']);
		await page.keyboard.press('Shift+ArrowRight');
		await expectPagePaths(page, ['album/03.png', 'album/04.png']);
		await clickSpread(page, 0.9);
		await expectPagePaths(
			page,
			pageCount === 5 ? ['album/05.png'] : ['album/05.png', 'album/06.png']
		);
		await page.keyboard.press('ArrowRight');
		await expectPagePaths(
			page,
			pageCount === 5 ? ['album/05.png'] : ['album/05.png', 'album/06.png']
		);
		await clickSpread(page, 0.1);
		await expectPagePaths(page, ['album/03.png', 'album/04.png']);
		await page.keyboard.press('ArrowLeft');
		await expectPagePaths(page, ['album/01.png', 'album/02.png']);
		await page.keyboard.press('Shift+ArrowLeft');
		await expectPagePaths(page, ['album/01.png', 'album/02.png']);
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

	await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.45, { steps: 5 });
	await page.mouse.up();
	await expect(rightPage.getByRole('textbox')).toHaveCount(2);
	const newBubble = rightPage.locator('foreignObject[data-bubble-index="1"]').getByRole('textbox');
	await newBubble.fill('New on right');
	await newBubble.click({ button: 'right' });
	await page.getByText('Convert to Poly', { exact: true }).click();
	await expect(rightPage.locator('.svgcontent polygon')).toHaveCount(1);
	await newBubble.click({ button: 'right' });
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
	await expectPagePaths(page, ['album/01.png', 'album/02.png']);
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
				paths: Array.from(document.querySelectorAll('[data-page-path]')).map((el) =>
					el.getAttribute('data-page-path')
				),
				width: content.width,
				height: content.height,
				loading: document.querySelector('main')!.textContent!.includes('Loading page...')
			});
		}
		return samples;
	});
	for (const sample of frames) {
		expect(sample.paths).toEqual(['album/01.png', 'album/02.png']);
		expect(sample.width).toBe(before!.width);
		expect(sample.height).toBe(before!.height);
		expect(sample.loading).toBe(false);
	}
	await page.evaluate(() => window.__releaseImage());
	await expectPagePaths(page, ['album/03.png', 'album/04.png']);
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
	await expectPagePaths(page, ['album/05.png']);
	await page.evaluate(() => window.__releaseImage());
	await expect.poll(() => page.evaluate(() => window.__imageUrls.revoked.length)).toBe(4);
	await expectPagePaths(page, ['album/05.png']);
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
	await expectPagePaths(page, ['album/01.png', 'album/02.png']);
	await page.locator('main').click({ position: { x: 1430, y: 400 } });
	await expectPagePaths(page, ['album/03.png', 'album/04.png']);
	await page.keyboard.press('Shift+ArrowLeft');
	await expectPagePaths(page, ['album/02.png', 'album/03.png']);
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

const visionResponse = {
	responses: [
		{
			textAnnotations: [
				{ description: 'Hello world', locale: 'en' },
				{
					description: 'Hello',
					boundingPoly: {
						vertices: [
							{ x: 80, y: 80 },
							{ x: 170, y: 80 },
							{ x: 170, y: 120 },
							{ x: 80, y: 120 }
						]
					}
				},
				{
					description: 'world',
					boundingPoly: {
						vertices: [
							{ x: 180, y: 80 },
							{ x: 280, y: 80 },
							{ x: 280, y: 120 },
							{ x: 180, y: 120 }
						]
					}
				}
			]
		}
	]
};

test('external Google Vision key overrides saved settings and replaces key controls', async ({
	page
}) => {
	test.skip(!process.env.GOOGLE_VISION_KEY?.trim(), 'Requires an externally configured dev server');
	await page.addInitScript(() => {
		localStorage.setItem('comix-sense.google-vision-api-key', 'saved-browser-key');
	});
	await mockDirectory(page);
	await openComic(page);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Google Vision OCR', exact: true });
	await expect(settings).toContainText('Using the externally set GOOGLE_VISION_KEY.');
	await expect(settings.locator('input')).toHaveCount(0);
	await expect(settings.getByRole('button', { name: 'Forget key', exact: true })).toHaveCount(0);
	await expect(settings.getByRole('button', { name: 'Use key', exact: true })).toHaveCount(0);
	await settings.getByRole('button', { name: 'Close the modal', exact: true }).click();
	let requests = 0;
	await page.route('https://vision.googleapis.com/**', async (route) => {
		requests++;
		expect(route.request().headers()['x-goog-api-key']).toBe(process.env.GOOGLE_VISION_KEY!.trim());
		await route.fulfill({ json: visionResponse });
	});
	await page.getByRole('button', { name: 'Scan Full Page', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'OCR', exact: true })).toBeVisible();
	expect(requests).toBe(1);
	expect(await page.evaluate(() => localStorage.getItem('comix-sense.google-vision-api-key'))).toBe(
		'saved-browser-key'
	);
});

test('scan creates a session OCR overlay and preserves existing translations', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await expect(page.getByRole('button', { name: 'Scan Full Page' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	const scan = page.getByRole('button', { name: 'Scan Full Page' });
	await expect(scan).toHaveAttribute('title', 'Scan Full Page');
	await expect(scan).toHaveText('');
	let requests = 0;
	await page.route('https://vision.googleapis.com/**', async (route) => {
		requests++;
		expect(route.request().headers()['x-goog-api-key']).toBe('test-session-key');
		const request = route.request().postDataJSON();
		expect(request.requests[0].features).toEqual([{ type: 'TEXT_DETECTION' }]);
		expect(atob(request.requests[0].image.content)).toContain('<svg');
		await route.fulfill({ json: visionResponse });
	});
	await scan.click();
	await page.getByLabel('Google Vision API key', { exact: true }).fill('test-session-key');
	await page.getByRole('button', { name: 'Use key', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await expect(page.getByRole('menuitem', { name: 'OCR', exact: true })).toBeVisible();
	await expect(scan).toBeFocused();
	await expect(page.getByRole('menuitem', { name: 'OCR', exact: true })).toBeVisible();
	expect(requests).toBe(1);
	expect(
		await page.evaluate(() => localStorage.getItem('comix-sense.google-vision-api-key'))
	).toBeNull();
	await page.getByRole('menuitem', { name: 'OCR', exact: true }).click();
	await expect(page.getByRole('menuitemradio', { name: 'MRG', exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await selectMenu(page, 'OCR', 'EN');
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await selectMenu(page, 'EN', 'OCR');
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
});

test('Scan label includes all page languages and remembered keys can be forgotten', async ({
	page
}) => {
	await mockDirectory(page, { overlays: 'none' });
	await openComic(page);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	const scan = page.getByRole('button', { name: 'Scan Full Page' });
	await expect(scan).toHaveText('Scan');
	await page.route('https://vision.googleapis.com/**', (route) =>
		route.fulfill({ json: visionResponse })
	);
	await scan.click();
	await page.getByLabel('Google Vision API key', { exact: true }).fill('remembered-key');
	await page.getByLabel('Remember on this browser').check();
	await page.getByRole('button', { name: 'Use key', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await expect(scan).toHaveText('');
	expect(await page.evaluate(() => localStorage.getItem('comix-sense.google-vision-api-key'))).toBe(
		'remembered-key'
	);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Add folder' })).toBeEnabled();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	await expect(page.getByLabel('Google Vision API key', { exact: true })).toHaveValue(
		'remembered-key'
	);
	await page.getByRole('button', { name: 'Forget key', exact: true }).click();
	await expect(page.getByLabel('Google Vision API key', { exact: true })).toHaveValue('');
	expect(
		await page.evaluate(() => localStorage.getItem('comix-sense.google-vision-api-key'))
	).toBeNull();
});

test('failed scans preserve an existing OCR overlay', async ({ page }) => {
	await mockDirectory(page, { overlays: 'ocr', browserLanguages: ['OCR'] });
	await openComic(page);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	const scan = page.getByRole('button', { name: 'Scan Full Page' });
	await expect(scan).toHaveText('');
	await page.route('https://vision.googleapis.com/**', (route) =>
		route.fulfill({ json: { responses: [{ error: { message: 'Invalid API key' } }] } })
	);
	await scan.click();
	await page.getByLabel('Google Vision API key', { exact: true }).fill('invalid-key');
	await page.getByRole('button', { name: 'Use key', exact: true }).click();
	await page.getByRole('button', { name: 'Overwrite and scan', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Invalid API key');
	await expect(page.locator('foreignObject')).toHaveText('Old OCR');
	await expect(scan).toBeEnabled();
});

test('late scans stay with their page and successful rescans refresh OCR', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await selectMenu(page, 'ORG', 'EN');
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	await page.getByLabel('Google Vision API key', { exact: true }).fill('test-key');
	await page.getByRole('button', { name: 'Use key', exact: true }).click();
	await expect(page.getByRole('button', { name: 'OCR Settings', exact: true })).toBeFocused();
	let finish!: () => void;
	const gate = new Promise<void>((resolve) => {
		finish = resolve;
	});
	await page.route('https://vision.googleapis.com/**', async (route) => {
		await gate;
		await route.fulfill({ json: visionResponse });
	});
	const scan = page.getByRole('button', { name: 'Scan Full Page' });
	await scan.click();
	await expect(scan).toBeDisabled();
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
	finish();
	await expect(scan).toBeEnabled();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await selectMenu(page, 'EN', 'OCR');
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await page.unroute('https://vision.googleapis.com/**');
	let rescans = 0;
	await page.route('https://vision.googleapis.com/**', (route) => {
		rescans++;
		return route.fulfill({ json: { responses: [{}] } });
	});
	await scan.click();
	const confirmation = page.getByRole('dialog', { name: 'Overwrite OCR overlay?' });
	await expect(confirmation).toContainText('OCR text and shapes');
	await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(scan).toBeFocused();
	await expect(scan).toBeEnabled();
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	expect(rescans).toBe(0);
	await scan.click();
	await confirmation.getByRole('button', { name: 'Overwrite and scan', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'No text recognized' })).toBeVisible();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await expect(scan).toBeFocused();
	await expect(page.getByRole('menuitem', { name: 'OCR', exact: true })).toBeVisible();
	await page.getByRole('menuitem', { name: 'OCR', exact: true }).click();
	await expect(page.getByRole('menuitemradio', { name: 'MRG', exact: true })).toHaveCount(0);
});

test('a scan with no text creates OCR without creating or selecting MRG', async ({ page }) => {
	await mockDirectory(page, { overlays: 'none' });
	await openComic(page);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.route('https://vision.googleapis.com/**', (route) =>
		route.fulfill({ json: { responses: [{}] } })
	);
	const scan = page.getByRole('button', { name: 'Scan Full Page' });
	await scan.click();
	await page.getByLabel('Google Vision API key', { exact: true }).fill('test-key');
	await page.getByRole('button', { name: 'Use key', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'No text recognized' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'OCR', exact: true })).toBeVisible();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await expect(scan).toBeFocused();
	await page.getByRole('menuitem', { name: 'OCR', exact: true }).click();
	await expect(page.getByRole('menuitemradio', { name: 'MRG', exact: true })).toHaveCount(0);
	await expect(page.getByRole('menuitemradio', { name: 'OCR', exact: true })).toBeVisible();
});

for (const scope of ['page', 'album']) {
	test(`AI cleanup replaces only the selected overlay for ${scope}`, async ({ page }) => {
		await mockDirectory(page);
		await openComic(page);
		await selectMenu(page, 'ORG', 'EN');
		await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
		await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
		await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
		await page.getByLabel('Provider URL', { exact: true }).fill('https://ai.example/v1');
		await page.getByRole('combobox', { name: 'Cleanup model', exact: true }).fill('cleanup-model');
		await page.getByLabel('AI API key', { exact: true }).fill('session-secret');
		await page.getByRole('button', { name: 'Save settings', exact: true }).click();
		let requests = 0;
		await page.route('https://ai.example/v1/chat/completions', async (route) => {
			requests++;
			expect(route.request().headers().authorization).toBe('Bearer session-secret');
			const body = route.request().postDataJSON();
			expect(body.model).toBe('cleanup-model');
			expect(body.response_format.type).toBe('json_schema');
			expect(body.response_format.json_schema.strict).toBe(true);
			const document = JSON.parse(body.messages[1].content);
			expect(document.sourceLanguage).toBe('en');
			expect(document.targetLanguage).toBe('en');
			expect(document.items.map((item: { id: string }) => item.id)).toEqual(
				scope === 'page' ? ['/pages/0/bubbles/0'] : ['/pages/0/bubbles/0', '/pages/1/bubbles/0']
			);
			document.items.forEach((item: { text: string }) => {
				item.text += '!';
			});
			document.items.reverse();
			await route.fulfill({
				json: {
					choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }]
				}
			});
		});
		await page.getByRole('button', { name: 'Cleanup Text', exact: true }).click();
		await page.getByLabel('Scope', { exact: true }).selectOption(scope);
		await page.getByRole('button', { name: 'Clean text', exact: true }).click();
		await expect(page.locator('foreignObject')).toHaveText('Hello!');
		// Carbon restores the dialog trigger's focus after its closing transition.
		// Wait before opening another menu so that restoration cannot close it.
		await expect(page.getByRole('button', { name: 'Cleanup Text', exact: true })).toBeFocused();
		await expect(page.getByRole('status').filter({ hasText: 'bubble text' })).toContainText(
			scope === 'page' ? '1 bubble text' : '2 bubble texts'
		);
		expect(requests).toBe(1);
		expect(
			JSON.parse((await page.evaluate(() => localStorage.getItem('comix-sense.ai-settings')))!)
				.apiKey
		).toBe('');
		await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
		await page.getByRole('menuitemradio', { name: 'Dutch (NL)', exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('foreignObject')).toHaveText('Hallo');
		await page.getByRole('menuitem', { name: 'NL', exact: true }).click();
		await page.getByRole('menuitemradio', { name: 'English (EN)', exact: true }).focus();
		await page.keyboard.press('Enter');
		await page.getByRole('button', { name: 'Next Page', exact: true }).click();
		await expect(page.locator('foreignObject')).toHaveText(
			scope === 'page' ? 'Second page' : 'Second page!'
		);
	});
}

test('AI settings remember and forget the key independently of Google Vision', async ({ page }) => {
	await mockDirectory(page);
	await openComic(page);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
	await page.getByRole('combobox', { name: 'Cleanup model', exact: true }).fill('test-model');
	await page.getByLabel('AI API key', { exact: true }).fill('remembered-secret');
	await page.getByLabel('Remember on this browser').check();
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	expect(
		JSON.parse((await page.evaluate(() => localStorage.getItem('comix-sense.ai-settings')))!).apiKey
	).toBe('remembered-secret');
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
	await expect(page.getByLabel('AI API key', { exact: true })).toHaveValue('remembered-secret');
	await page.getByRole('button', { name: 'Forget key', exact: true }).click();
	await expect(page.getByLabel('AI API key', { exact: true })).toHaveValue('');
	expect(
		JSON.parse((await page.evaluate(() => localStorage.getItem('comix-sense.ai-settings')))!).apiKey
	).toBe('');
	await page.getByRole('tab', { name: 'Google Vision OCR', exact: true }).click();
	await expect(
		page.getByText('Full-page scans send the selected page image to Google Cloud Vision.')
	).toBeVisible();
});

for (const failure of ['invalid JSON', 'concurrent edit', 'cancel']) {
	test(`AI cleanup preserves text after ${failure}`, async ({ page }) => {
		await mockDirectory(page);
		await page.addInitScript(() =>
			localStorage.setItem(
				'comix-sense.ai-settings',
				JSON.stringify({ url: 'https://ai.example/v1', model: 'test', apiKey: '' })
			)
		);
		await openComic(page);
		await selectMenu(page, 'ORG', 'EN');
		await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let received!: () => void;
		const started = new Promise<void>((resolve) => {
			received = resolve;
		});
		await page.route('https://ai.example/v1/chat/completions', async (route) => {
			const document = JSON.parse(route.request().postDataJSON().messages[1].content);
			received();
			await gate;
			document.items[0].text = 'AI replacement';
			await route.fulfill({
				json: {
					choices: [
						{
							finish_reason: 'stop',
							message: { content: failure === 'invalid JSON' ? 'oops' : JSON.stringify(document) }
						}
					]
				}
			});
		});
		await page.getByRole('button', { name: 'Cleanup Text', exact: true }).click();
		await page.getByRole('button', { name: 'Clean text', exact: true }).click();
		await started;
		if (failure === 'concurrent edit') await page.getByRole('textbox').fill('Manual edit');
		if (failure === 'cancel')
			await page.getByRole('button', { name: 'Cancel cleanup', exact: true }).click();
		release();
		await expect(page.getByRole('alert').filter({ hasText: /Cleanup/ })).toContainText(
			failure === 'invalid JSON'
				? 'valid JSON'
				: failure === 'cancel'
					? 'cancelled'
					: 'text changed'
		);
		await expect(page.locator('foreignObject')).toHaveText(
			failure === 'concurrent edit' ? 'Manual edit' : 'Hello'
		);
		await expect(page.getByRole('button', { name: 'Cleanup Text', exact: true })).toBeEnabled();
	});
}

for (const allOmitted of [false, true]) {
	test(`AI partial cleanup rejects the response and preserves all bubbles (${allOmitted ? 'all' : 'some'})`, async ({
		page
	}) => {
		await mockDirectory(page);
		await page.addInitScript(() =>
			localStorage.setItem(
				'comix-sense.ai-settings',
				JSON.stringify({ url: 'https://ai.example/v1', model: 'test', apiKey: '' })
			)
		);
		await openComic(page);
		await selectMenu(page, 'ORG', 'EN');
		await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
		await page.route('https://ai.example/v1/chat/completions', async (route) => {
			const document = JSON.parse(route.request().postDataJSON().messages[1].content);
			document.items = allOmitted ? [] : [{ id: '/pages/1/bubbles/0', text: 'Second corrected' }];
			await route.fulfill({
				json: {
					choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }]
				}
			});
		});
		await page.getByRole('button', { name: 'Cleanup Text', exact: true }).click();
		await page.getByLabel('Scope', { exact: true }).selectOption('album');
		await page.getByRole('button', { name: 'Clean text', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText(
			'AI response changed the document structure, languages, IDs, or empty fields. No text was replaced.'
		);
		await expect(page.locator('foreignObject')).toHaveText('Hello');
		await page.getByRole('button', { name: 'Next Page', exact: true }).click();
		await expect(page.locator('foreignObject')).toHaveText('Second page');
	});
}

async function setupAiTranslation(page: Page, mode = '1P') {
	await mockDirectory(page);
	await page.addInitScript(() =>
		localStorage.setItem(
			'comix-sense.ai-settings',
			JSON.stringify({ url: 'https://ai.example/v1', model: 'test-translator', apiKey: '' })
		)
	);
	await openComic(page, mode);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeDisabled();
	await selectMenu(page, 'ORG', 'EN');
}

async function chooseTranslationLanguage(page: Page, language: string) {
	await page.getByRole('button', { name: 'Translate', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Translate page', exact: true })).toContainText(
		"Translate the selected page's bubble text from English (EN) into:"
	);
	await page.getByRole('combobox', { name: 'Target language', exact: true }).click();
	const option = page.getByRole('option', {
		name: ({ FR: 'French (FR)', NL: 'Dutch (NL)' } as Record<string, string>)[language] ?? language,
		exact: true
	});
	await expect(option.locator('img')).toBeVisible();
	await option.click();
	await page
		.getByRole('dialog', { name: 'Translate page', exact: true })
		.getByRole('button', { name: 'OK', exact: true })
		.click();
}

test('AI translation creates a new page overlay using flags, schema and the translation prompt', async ({
	page
}) => {
	await setupAiTranslation(page, '2P');
	await page.route('https://ai.example/v1/chat/completions', async (route) => {
		const body = route.request().postDataJSON();
		expect(body.messages[0].content).toContain('professional comic-book translator');
		expect(body.response_format.json_schema.strict).toBe(true);
		const document = JSON.parse(body.messages[1].content);
		expect(document).toEqual({
			sourceLanguage: 'en',
			targetLanguage: 'fr',
			items: [{ id: '/pages/0/bubbles/0', text: 'Hello' }]
		});
		document.items[0].text = 'Bonjour !';
		await route.fulfill({
			json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }] }
		});
	});
	await chooseTranslationLanguage(page, 'FR');
	await expect(page.locator('foreignObject')).toHaveText('Bonjour !');
	await expect(page.getByRole('menuitem', { name: 'FR', exact: true })).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: 'translated to FR' })).toBeVisible();
	await page.getByRole('menuitem', { name: 'FR', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'English (EN)', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('foreignObject')).toHaveText(['Hello', 'Second page']);
});

test('AI translation confirms existing target overwrite before contacting the provider', async ({
	page
}) => {
	await setupAiTranslation(page);
	let requests = 0;
	await page.route('https://ai.example/v1/chat/completions', async (route) => {
		requests++;
		const document = JSON.parse(route.request().postDataJSON().messages[1].content);
		expect(document.targetLanguage).toBe('nl');
		document.items[0].text = 'Goedendag';
		await route.fulfill({
			json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }] }
		});
	});
	await chooseTranslationLanguage(page, 'NL');
	const confirmation = page.getByRole('dialog', { name: 'Overwrite translation?', exact: true });
	await expect(confirmation).toBeVisible();
	expect(requests).toBe(0);
	await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(requests).toBe(0);
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await chooseTranslationLanguage(page, 'NL');
	await confirmation.getByRole('button', { name: 'Overwrite and translate', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Goedendag');
	expect(requests).toBe(1);
	await page.getByRole('button', { name: 'Next Page', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Tweede pagina');
});

test('late AI translation stays with its source page and does not change the current page language', async ({
	page
}) => {
	await setupAiTranslation(page);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let received!: () => void;
	const started = new Promise<void>((resolve) => {
		received = resolve;
	});
	await page.route('https://ai.example/v1/chat/completions', async (route) => {
		const document = JSON.parse(route.request().postDataJSON().messages[1].content);
		received();
		await gate;
		document.items[0].text = 'Bonjour';
		await route.fulfill({
			json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }] }
		});
	});
	await chooseTranslationLanguage(page, 'FR');
	await started;
	await page.getByRole('button', { name: 'Next Page', exact: true }).click();
	release();
	await expect(page.getByRole('status').filter({ hasText: 'translated to FR' })).toBeVisible();
	await expect(page.locator('foreignObject')).toHaveText('Second page');
	await expect(page.getByRole('menuitem', { name: 'EN', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Previous Page', exact: true }).click();
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'French (FR)', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('foreignObject')).toHaveText('Bonjour');
});

test('failed AI translation leaves the source and language list intact', async ({ page }) => {
	await setupAiTranslation(page);
	await page.route('https://ai.example/v1/chat/completions', (route) =>
		route.fulfill({ status: 400, json: {} })
	);
	await chooseTranslationLanguage(page, 'FR');
	await expect(page.getByRole('alert').filter({ hasText: 'Translation failed' })).toBeVisible();
	await expect(page.locator('foreignObject')).toHaveText('Hello');
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await expect(page.getByRole('menuitemradio', { name: 'French (FR)', exact: true })).toHaveCount(
		0
	);
});

for (const [overlay, declared, expected] of [
	['OCR', 'nl', 'Dutch (NL)'],
	['OCR', undefined, '(Unknown)'],
	['OCR', 'und', '(Unknown)']
] as const) {
	test(`translation dialog resolves ${overlay} source language ${declared ?? 'missing'} from BBL`, async ({
		page
	}) => {
		await mockDirectory(page, {
			overlays: 'ocr',
			overlayLanguage: declared
		});
		await openComic(page);
		await selectMenu(page, 'ORG', overlay);
		await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
		await page.getByRole('button', { name: 'Translate', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Translate page', exact: true })).toContainText(
			`Translate the selected page's bubble text from ${expected} into:`
		);
	});
}

async function openAiPreferences(page: Page) {
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
}

async function setupAiPreferences(page: Page) {
	await mockDirectory(page);
	await page.addInitScript(() => {
		if (!localStorage.getItem('comix-sense.ai-settings'))
			localStorage.setItem(
				'comix-sense.ai-settings',
				JSON.stringify({
					url: 'https://settings.example/v1',
					model: 'legacy-model',
					apiKey: 'saved-key'
				})
			);
	});
	await page.route('https://settings.example/v1/models', (route) =>
		route.fulfill({ json: { data: [{ id: 'model-a' }, { id: 'model-b' }] } })
	);
	await openComic(page);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await openAiPreferences(page);
}

test('AI settings model comboboxes share discovered models and always preserve custom input', async ({
	page
}) => {
	await setupAiPreferences(page);
	const cleanup = page.getByRole('combobox', { name: 'Cleanup model', exact: true });
	const translation = page.getByRole('combobox', { name: 'Translation model', exact: true });
	await expect(cleanup).toHaveValue('legacy-model');
	await expect(translation).toHaveValue('legacy-model');
	await expect(page.getByRole('status').filter({ hasText: '2 models available' })).toBeVisible();
	await page.getByRole('button', { name: 'Dismiss model discovery notification' }).click();
	await expect(page.getByRole('status').filter({ hasText: '2 models available' })).toBeHidden();
	const cleanupOptions = page
		.getByRole('listbox', { name: 'Cleanup model', exact: true })
		.getByRole('option');
	await cleanup.fill('DEL-A');
	await expect(cleanupOptions).toHaveText(['model-a']);
	await cleanup.fill('');
	await expect(cleanupOptions).toHaveCount(2);
	await cleanup.fill('model-');
	await page
		.getByRole('listbox', { name: 'Cleanup model', exact: true })
		.getByRole('option', { name: 'model-a', exact: true })
		.click();
	await expect(cleanup).toHaveValue('model-a');
	await cleanup.fill('my-unlisted-model');
	await expect(cleanupOptions).toHaveCount(0);
	await translation.focus();
	await expect(cleanup).toHaveValue('my-unlisted-model');
	await translation.fill('model-');
	const translationOptions = page
		.getByRole('listbox', { name: 'Translation model', exact: true })
		.getByRole('option');
	await expect(translationOptions).toHaveCount(2);
	await translation.fill('DEL-B');
	await expect(translationOptions).toHaveText(['model-b']);
	await page
		.getByRole('listbox', { name: 'Translation model', exact: true })
		.getByRole('option', { name: 'model-b', exact: true })
		.click();
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('comix-sense.ai-settings')!)
	);
	expect(stored.cleanup.model).toBe('my-unlisted-model');
	expect(stored.translation.model).toBe('model-b');
	expect(stored.model).toBeUndefined();
	await openAiPreferences(page);
	await expect(cleanup).toHaveValue('my-unlisted-model');
	await expect(translation).toHaveValue('model-b');
});

test('AI model discovery failure clears stale suggestions without changing typed models', async ({
	page
}) => {
	await setupAiPreferences(page);
	await expect(page.getByRole('status').filter({ hasText: '2 models available' })).toBeVisible();
	const cleanup = page.getByRole('combobox', { name: 'Cleanup model', exact: true });
	const translation = page.getByRole('combobox', { name: 'Translation model', exact: true });
	await cleanup.fill('private-cleanup');
	await translation.fill('private-translation');
	let requests = 0;
	await page.route('https://offline.example/v1/models', (route) => {
		requests++;
		return route.fulfill({ status: 404, json: {} });
	});
	await page.getByLabel('Provider URL', { exact: true }).fill('https://offline.example/v1');
	await expect.poll(() => requests).toBe(1);
	await expect(page.getByRole('status').filter({ hasText: 'No model suggestions' })).toBeVisible();
	await expect(cleanup).toHaveValue('private-cleanup');
	await expect(translation).toHaveValue('private-translation');
	await cleanup.press('ArrowDown');
	await expect(
		page.getByRole('listbox', { name: 'Cleanup model', exact: true }).getByRole('option')
	).toHaveCount(0);
	await cleanup.press('Escape');
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('comix-sense.ai-settings')!)
	);
	expect(stored.cleanup.model).toBe('private-cleanup');
	expect(stored.translation.model).toBe('private-translation');
});

test('AI prompt editors stage changes until Save, support Cancel and restore defaults', async ({
	page
}) => {
	await setupAiPreferences(page);
	const cleanupPromptText = 'Clean {sourceLanguage} while keeping every ID.';
	const translationPromptText = 'Translate {sourceLanguage} to {targetLanguage} concisely.';
	async function edit(task: 'cleanup' | 'translation', prompt: string) {
		await page.getByRole('button', { name: `Edit ${task} prompt`, exact: true }).click();
		await page.getByLabel('Instructions', { exact: true }).fill(prompt);
		await page.getByRole('button', { name: 'Use prompt', exact: true }).click();
	}
	await edit('cleanup', cleanupPromptText);
	await edit('translation', translationPromptText);
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await openAiPreferences(page);
	await expect(page.getByRole('region', { name: 'Cleanup', exact: true })).toContainText('Default');
	await expect(page.getByRole('region', { name: 'Translation', exact: true })).toContainText(
		'Default'
	);
	await edit('cleanup', cleanupPromptText);
	await edit('translation', translationPromptText);
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	let stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('comix-sense.ai-settings')!)
	);
	expect(stored.cleanup.prompt).toBe(cleanupPromptText);
	expect(stored.translation.prompt).toBe(translationPromptText);
	await openAiPreferences(page);
	await page.getByRole('button', { name: 'Edit translation prompt', exact: true }).click();
	await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(translationPromptText);
	await page.getByLabel('Instructions', { exact: true }).fill('Unsaved editor text');
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await page.getByRole('button', { name: 'Edit translation prompt', exact: true }).click();
	await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(translationPromptText);
	await page.getByLabel('Instructions', { exact: true }).fill('');
	await expect(page.getByRole('button', { name: 'Use prompt', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: '{sourceLanguage}', exact: true }).click();
	await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue('{sourceLanguage}');
	await page.getByRole('button', { name: 'Restore default prompt', exact: true }).click();
	await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(
		/You are a professional comic-book translator/
	);
	await page.getByRole('button', { name: 'Use prompt', exact: true }).click();
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	stored = await page.evaluate(() => JSON.parse(localStorage.getItem('comix-sense.ai-settings')!));
	expect(stored.translation.prompt).toBeUndefined();
	expect(stored.cleanup.prompt).toBe(cleanupPromptText);
});

test('AI Forget key does not discard model or prompt drafts', async ({ page }) => {
	await setupAiPreferences(page);
	await page.getByRole('combobox', { name: 'Cleanup model', exact: true }).fill('draft-model');
	await page.getByRole('button', { name: 'Edit cleanup prompt', exact: true }).click();
	await page.getByLabel('Instructions', { exact: true }).fill('Draft prompt');
	await page.getByRole('button', { name: 'Use prompt', exact: true }).click();
	await page.getByRole('button', { name: 'Forget key', exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Cleanup model', exact: true })).toHaveValue(
		'draft-model'
	);
	await expect(page.getByRole('region', { name: 'Cleanup', exact: true })).toContainText(
		'Customized'
	);
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('comix-sense.ai-settings')!)
	);
	expect(stored.apiKey).toBe('');
	expect(stored.cleanup).toEqual({ model: 'draft-model', prompt: 'Draft prompt' });
});

test('AI actions use the saved per-task model and expanded custom prompt', async ({ page }) => {
	await setupAiPreferences(page);
	await page.getByRole('combobox', { name: 'Cleanup model', exact: true }).fill('custom-cleaner');
	await page
		.getByRole('combobox', { name: 'Translation model', exact: true })
		.fill('custom-translator');
	for (const [task, prompt] of [
		['cleanup', 'Clean {sourceLanguage}'],
		['translation', 'Translate {sourceLanguage} to {targetLanguage}']
	]) {
		await page.getByRole('button', { name: `Edit ${task} prompt`, exact: true }).click();
		await page.getByLabel('Instructions', { exact: true }).fill(prompt);
		await page.getByRole('button', { name: 'Use prompt', exact: true }).click();
	}
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	await selectMenu(page, 'ORG', 'EN');
	const models: string[] = [];
	await page.route('https://settings.example/v1/chat/completions', async (route) => {
		const body = route.request().postDataJSON();
		models.push(body.model);
		const document = JSON.parse(body.messages[1].content);
		const translating = document.targetLanguage === 'fr';
		expect(body.model).toBe(translating ? 'custom-translator' : 'custom-cleaner');
		expect(body.messages[0].content).toBe(translating ? 'Translate en to fr' : 'Clean en');
		expect(body.response_format.json_schema.strict).toBe(true);
		document.items[0].text = translating ? 'Bonjour' : 'Hello cleaned';
		await route.fulfill({
			json: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }] }
		});
	});
	await page.getByRole('button', { name: 'Cleanup Text', exact: true }).click();
	await page.getByRole('button', { name: 'Clean text', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Hello cleaned');
	// An unused tool's empty model must not prevent using the configured tool.
	await openAiPreferences(page);
	await page.getByRole('combobox', { name: 'Cleanup model', exact: true }).fill('');
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	await chooseTranslationLanguage(page, 'FR');
	await expect(page.locator('foreignObject')).toHaveText('Bonjour');
	expect(models).toEqual(['custom-cleaner', 'custom-translator']);
});

test('AI model discovery ignores late responses from an old provider', async ({ page }) => {
	await setupAiPreferences(page);
	await expect(page.getByRole('status').filter({ hasText: '2 models available' })).toBeVisible();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started!: () => void;
	const pending = new Promise<void>((resolve) => {
		started = resolve;
	});
	let completed!: () => void;
	const finished = new Promise<void>((resolve) => {
		completed = resolve;
	});
	await page.route('https://slow.example/v1/models', async (route) => {
		started();
		await gate;
		try {
			await route.fulfill({ json: { data: [{ id: 'old-model' }] } });
		} catch {
			/* Changing the provider aborts the old request. */
		} finally {
			completed();
		}
	});
	await page.route('https://current.example/v1/models', (route) =>
		route.fulfill({ json: { data: [{ id: 'current-model' }] } })
	);
	await page.getByLabel('Provider URL', { exact: true }).fill('https://slow.example/v1');
	await pending;
	await page.getByLabel('Provider URL', { exact: true }).fill('https://current.example/v1');
	await expect(page.getByRole('status').filter({ hasText: '1 models available' })).toBeVisible();
	release();
	await finished;
	const cleanup = page.getByRole('combobox', { name: 'Cleanup model', exact: true });
	await expect(cleanup).toHaveValue('legacy-model');
	await cleanup.fill('current');
	const choices = page.getByRole('listbox', { name: 'Cleanup model', exact: true });
	await expect(choices.getByRole('option', { name: 'current-model', exact: true })).toBeVisible();
	await expect(choices.getByRole('option', { name: 'old-model', exact: true })).toHaveCount(0);
});

test('MRG is an ordinary overlay and scanning only creates OCR', async ({ page }) => {
	await mockDirectory(page, { overlays: 'mrg', browserLanguages: ['MRG'] });
	await openComic(page);
	await expect(page.getByRole('menuitem', { name: 'MRG', exact: true })).toBeVisible();
	await expect(page.locator('[data-language-icon="object-group"]')).toHaveCount(0);
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveText('Old MRG');
	await page.route('https://vision.googleapis.com/**', (route) =>
		route.fulfill({ json: visionResponse })
	);
	await page.getByRole('button', { name: 'Scan Full Page', exact: true }).click();
	await page.getByLabel('Google Vision API key', { exact: true }).fill('test-key');
	await page.getByRole('button', { name: 'Use key', exact: true }).click();
	await expect(page.getByRole('menuitem', { name: 'OCR', exact: true })).toBeVisible();
	await expect(page.locator('foreignObject')).toHaveText('Hello world');
	await selectMenu(page, 'OCR', 'MRG');
	await expect(page.locator('foreignObject')).toHaveText('Old MRG');
});
