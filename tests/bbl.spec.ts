import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { AlbumMetadata, type Source } from '../src/lib/bbl/AlbumMetadata';
import {
	Diagnostics,
	font,
	matchDocument,
	parseDocument,
	relativePath
} from '../src/lib/bbl/metadata';
import { textStyle } from '../src/lib/bbl/FontResources';
import { zipBytes, png } from './archive-fixtures';

const bubble = (text: string, font = {}) => ({
	text,
	font,
	shape: {
		type: 'box',
		vs: [
			{ x: 10, y: 20 },
			{ x: 200, y: 100 }
		]
	}
});
const json = (value: unknown) => JSON.stringify(value);
const source = (path: string, language: string, data: unknown, exact = true): Source => ({
	path,
	language,
	exact,
	read: async () => json(data)
});
async function album(files: Record<string, unknown>, images = ['01.jpg'], adjacent: Source[] = []) {
	const instance = new AlbumMetadata(async (path) => {
		if (!(path in files)) throw new Error('Missing fixture: ' + path);
		return new Blob([json(files[path])]);
	});
	await instance.discover(Object.keys(files), images, adjacent);
	return instance;
}

test('property validation preserves valid fields, explicit resets and family replacement', () => {
	const diagnostics = new Diagnostics();
	const warnings: string[] = [];
	diagnostics.warn = (...args) => {
		warnings.push(args.join(' '));
	};
	expect(
		font(
			{ size: -3, family: [], style: null, weight: 1001, lineHeight: 1.2, letterSpacing: -2 },
			'test.font',
			diagnostics
		)
	).toEqual({ lineHeight: 1.2, letterSpacing: -2 });
	expect(warnings).toHaveLength(4);
	expect(font(null, 'test.font', diagnostics)).toEqual({});
	expect(font({}, 'test.font', diagnostics)).toEqual({});
	expect(
		font({ family: ['serif'], style: 'normal', weight: 1, size: 3 }, 'test.font', diagnostics)
	).toEqual({ family: ['serif'], style: 'normal', weight: 1, size: 3 });
	expect(textStyle({})).toBe('');
	expect(textStyle({ family: ['SERIF'] })).toBe('font-family:SERIF');
	expect(textStyle({ size: 30, lineHeight: 1.2, letterSpacing: -1 })).toBe(
		'font-size:30px;line-height:1.2;letter-spacing:-1px'
	);
});

test('exact filenames beat shorthand independent of language; ambiguous matches warn once', () => {
	const diagnostics = new Diagnostics();
	const original = console.warn,
		warnings: string[] = [];
	console.warn = (message) => warnings.push(message);
	try {
		expect(matchDocument('comic.jpg.en.bbl', ['comic.jpg', 'comic.webp'], diagnostics)).toEqual({
			target: 'comic.jpg',
			language: 'en',
			exact: true
		});
		expect(matchDocument('comic.en.bbl', ['comic.jpg'], diagnostics)?.exact).toBe(false);
		expect(
			matchDocument('mycomics.en.bbl', ['mycomics', 'mycomics.cbr'], diagnostics)?.target
		).toBe('mycomics');
		for (let i = 0; i < 3; i++) {
			expect(
				matchDocument('comic.en.bbl', ['comic.jpg', 'comic.webp'], diagnostics)
			).toBeUndefined();
			expect(matchDocument('book.fr.bbl', ['book.cbz', 'book.cbr'], diagnostics)).toBeUndefined();
		}
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain('comic.jpg, comic.webp');
		expect(warnings[0]).toContain('ignore document');
	} finally {
		console.warn = original;
	}
});

test('legacy sidecars, defaults-only indexes, language discovery and exact-name precedence', async () => {
	const instance = await album({
		'album.bbl': { font: { size: 30, family: ['serif'], style: 'italic' }, pages: [] },
		'album.fr.bbl': { font: { size: 99 } },
		'01.en.bbl': { font: { weight: 700 }, pages: [{ bubbles: [bubble('shorthand')] }] },
		'01.jpg.en.bbl': {
			font: { weight: 500 },
			pages: [{ font: { style: 'normal' }, bubbles: [bubble('exact', { size: 44 })] }]
		}
	});
	expect(instance.languages('01.jpg')).toEqual(['en']);
	const en = await instance.overlay('01.jpg', 'en');
	expect(en.bubbles[0].text).toBe('exact');
	expect(en.font).toEqual({ size: 30, family: ['serif'], style: 'normal', weight: 500 });
	expect(en.bubbles[0].font).toEqual({ size: 44 });
	expect((await instance.overlay('01.jpg', 'fr')).font.size).toBe(99);
	expect((await instance.overlay('01.jpg', 'fr')).bubbles).toEqual([]);
});

test('bubble-source priority is independent of property-wise typography and face inheritance', async () => {
	const instance = await album(
		{
			'album.bbl': {
				font: { family: ['Base', 'serif'], size: 20, style: 'italic' },
				fontFaces: [{ family: 'Base', src: 'fonts/base.ttf' }],
				pages: [{ filename: '01.jpg', font: { size: 24, weight: 300 } }]
			},
			'album.en.bbl': {
				font: { lineHeight: 1.1 },
				pages: [
					{ filename: '01.jpg', font: { weight: 400 }, bubbles: [bubble('internal')] },
					{ filename: '02.jpg', bubbles: [bubble('internal two')] }
				]
			},
			'01.jpg.en.bbl': {
				font: { style: 'normal' },
				pages: [{ bubbles: [bubble('sidecar', { weight: 900 })] }]
			},
			'02.jpg.en.bbl': { font: { letterSpacing: 2 }, pages: [{ font: { size: 60 } }] }
		},
		['01.jpg', '02.jpg', '03.jpg'],
		[
			source('../book.bbl', '', {
				font: { size: 35 },
				pages: [{ filename: '01.jpg', font: { weight: 500 } }]
			}),
			source('../book.en.bbl', 'en', {
				font: { family: ['Next', 'sans-serif'] },
				fontFaces: [
					{ family: 'Base', src: 'fonts/replaced.ttf' },
					{ family: 'Other', src: 'fonts/other.woff2' }
				],
				pages: [
					{ filename: '01.jpg', font: { size: 40 }, bubbles: [bubble('adjacent')] },
					{ filename: '02.jpg', bubbles: [] }
				]
			})
		]
	);
	const one = await instance.overlay('01.jpg', 'en');
	expect(one.bubbles.map((b) => b.text)).toEqual(['sidecar']);
	expect(one.font).toEqual({
		family: ['Next', 'sans-serif'],
		size: 40,
		style: 'normal',
		weight: 500,
		lineHeight: 1.1
	});
	expect(one.faces.map((f) => f.src)).toEqual(['fonts/replaced.ttf', 'fonts/other.woff2']);
	expect(one.bubbles[0].font).toEqual({ weight: 900 });
	const two = await instance.overlay('02.jpg', 'en');
	expect(two.bubbles).toEqual([]);
	expect(two.font.size).toBe(60);
	expect(two.font.letterSpacing).toBe(2);
	expect(instance.languages('03.jpg')).toEqual([]);
	expect((await instance.overlay('03.jpg', 'en')).font.size).toBe(35);
});

test('duplicate normalized pages, invalid paths, malformed indexes and optional metadata recover', async () => {
	const diagnostics = new Diagnostics();
	const original = console.warn,
		warnings: string[] = [];
	console.warn = (message) => warnings.push(message);
	try {
		const data = parseDocument(
			{
				font: { size: -1, weight: 700 },
				fontFaces: [
					null,
					{ family: 'A', src: '../escape.ttf' },
					{ family: 'A', src: 'fonts/a.ttf' }
				],
				pages: [
					{ filename: './01.jpg', bubbles: [] },
					{ filename: '01.jpg', bubbles: [bubble('ignored')] },
					{ filename: '../escape.jpg', bubbles: [] },
					{ filename: '/absolute.jpg', bubbles: [] },
					{ filename: 'x\\01.jpg' },
					{ filename: '02.jpg', font: null, bubbles: 'bad' }
				]
			},
			'album.bbl',
			true,
			diagnostics
		);
		expect(data.font).toEqual({ weight: 700 });
		expect(data.fontFaces).toHaveLength(1);
		expect(data.pages).toHaveLength(2);
		expect(data.pages[0].bubbles).toEqual([]);
		expect(relativePath('C:/escape.ttf')).toBeUndefined();
		const count = warnings.length;
		// Repeated parsing emits no repeated diagnostics.
		font({ size: -1 }, 'album.bbl.font', diagnostics);
		expect(warnings).toHaveLength(count);
		const instance = new AlbumMetadata(async () => new Blob(['{bad JSON']), diagnostics);
		await instance.discover(['album.en.bbl'], ['01.jpg']);
		expect(instance.languages('01.jpg')).toEqual([]);
		expect(warnings.some((w) => w.includes('ignore malformed index'))).toBe(true);
	} finally {
		console.warn = original;
	}
});

const fixtureFont = [...fs.readFileSync('tests/fixtures/fonts/bbl-test.ttf')];
const moduleTests = !!process.env.TEST_BASE_URL;

test('browser fonts load real local bytes, isolate, reuse, override installed names and release registrations', async ({
	page
}) => {
	test.skip(moduleTests, 'Vite module API check');
	await page.goto('./');
	const result = await page.evaluate(async (bytes) => {
		const modulePath = '/src/lib/bbl/FontResources.ts';
		const metadataPath = '/src/lib/bbl/metadata.ts';
		const { FontResources } = await import(/* @vite-ignore */ modulePath);
		const { Diagnostics } = await import(/* @vite-ignore */ metadataPath);
		const diagnostics = new Diagnostics();
		const first = new FontResources(diagnostics),
			second = new FontResources(diagnostics);
		let reads = 0;
		const read = async () => {
			reads++;
			return new Blob([new Uint8Array(bytes)]);
		};
		const faces = [
			{
				family: 'Arial',
				src: './fonts/test.ttf',
				document: 'book/album.bbl',
				style: 'normal',
				weight: 400,
				read
			}
		];
		const selected = { family: ['arial', 'SERIF'], size: 30 };
		const baseline = document.fonts.size;
		const [a, b] = await Promise.all([
			first.resolve(selected, faces),
			first.resolve(selected, faces)
		]);
		const c = await second.resolve(selected, faces);
		const loaded = document.fonts.check(`30px "${a.family[0]}"`, 'AB');
		const count = document.fonts.size - baseline;
		first.dispose();
		second.dispose();
		return { a, b, c, loaded, count, reads, remaining: document.fonts.size - baseline };
	}, fixtureFont);
	expect(result.a).toEqual(result.b);
	expect(result.a.family[0]).toMatch(/^bbl-face-/);
	expect(result.a.family[0]).not.toBe(result.c.family[0]);
	expect(result.loaded).toBe(true);
	expect(result.count).toBe(2);
	expect(result.reads).toBe(2);
	expect(result.remaining).toBe(0);
});

test('failed and timed-out fonts skip installed family, warn once, and cannot register late', async ({
	page
}) => {
	test.skip(moduleTests, 'Vite module API check');
	const warnings: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'warning') warnings.push(message.text());
	});
	page.on('dialog', () => {
		throw new Error('Recoverable metadata must not prompt');
	});
	await page.goto('./');
	const result = await page.evaluate(async (bytes) => {
		const modulePath = '/src/lib/bbl/FontResources.ts',
			metadataPath = '/src/lib/bbl/metadata.ts';
		const { FontResources } = await import(/* @vite-ignore */ modulePath);
		const { Diagnostics } = await import(/* @vite-ignore */ metadataPath);
		const resources = new FontResources(new Diagnostics(), 30);
		let release!: (blob: Blob) => void;
		// Ignore stylesheet fonts that may arrive while the app is still mounting.
		const registered = () =>
			[...document.fonts].filter((face) => face.family.startsWith('bbl-face-')).length;
		const baseline = registered();
		const faces = [
			{
				family: 'Arial',
				src: 'fonts/bad.ttf',
				document: 'book/album.bbl',
				style: 'normal',
				weight: 400,
				read: async () => new Blob(['invalid font'])
			},
			{
				family: 'Slow',
				src: 'fonts/slow.ttf',
				document: 'book/album.bbl',
				style: 'normal',
				weight: 400,
				read: () =>
					new Promise<Blob>((r) => {
						release = r;
					})
			}
		];
		const font = { family: ['Arial', 'Slow', 'monospace'] };
		const first = await resources.resolve(font, faces);
		const second = await resources.resolve(font, faces);
		release(new Blob([new Uint8Array(bytes)]));
		await new Promise((r) => setTimeout(r, 50));
		const late = registered() - baseline;
		resources.dispose();
		return { first, second, late };
	}, fixtureFont);
	expect(result.first.family).toEqual(['monospace', 'sans-serif']);
	expect(result.second).toEqual(result.first);
	expect(result.late).toBe(0);
	expect(warnings.filter((w) => w.startsWith('[bbl]'))).toHaveLength(2);
	expect(warnings.join('\n')).toContain('fonts/slow.ttf');
	expect(warnings.join('\n')).toContain('timed out');
});

test('directory and archive loaders resolve internal/adjacent indexes and album-relative resources', async ({
	page
}) => {
	test.skip(moduleTests, 'Vite module API check');
	const archive = await zipBytes({
		'pages/01.png': png,
		'pages/02.png': png,
		'album.bbl': new TextEncoder().encode(
			json({ font: { size: 25 }, fontFaces: [{ family: 'Fixture', src: './fonts/test.ttf' }] })
		),
		'album.en.bbl': new TextEncoder().encode(
			json({ pages: [{ filename: 'pages/01.png', bubbles: [bubble('internal')] }] })
		),
		'pages/01.png.en.bbl': new TextEncoder().encode(
			json({ pages: [{ bubbles: [bubble('archive sidecar')] }] })
		),
		'fonts/test.ttf': new Uint8Array(fixtureFont)
	});
	await page.goto('./');
	const result = await page.evaluate(
		async ({ archive, fontBytes }) => {
			const modulePath = '/src/lib/types/ComicStore.ts';
			const { DirectoryComicStore } = await import(/* @vite-ignore */ modulePath);
			const root = await navigator.storage.getDirectory();
			const dir = await root.getDirectoryHandle('bbl-fixture', { create: true });
			const files: Record<string, string | number[]> = {
				'book.cbz': archive,
				'book.cbz.en.bbl': JSON.stringify({
					font: { family: ['Fixture', 'serif'], size: 35 },
					pages: [
						{ filename: 'pages/01.png', bubbles: [] },
						{ filename: 'pages/02.png', bubbles: [] }
					]
				}),
				'book.en.bbl': JSON.stringify({
					font: { size: 90 },
					pages: [{ filename: 'pages/01.png', bubbles: [] }]
				}),
				'book/album.bbl': JSON.stringify({
					font: { family: ['Fixture', 'serif'], size: 31 },
					fontFaces: [{ family: 'Fixture', src: './fonts/test.ttf' }]
				}),
				'book/pages/01.png': archive.slice(0, 1),
				'book/pages/01.en.bbl': JSON.stringify({
					pages: [
						{
							bubbles: [
								{
									text: 'directory sidecar',
									shape: {
										type: 'box',
										vs: [
											{ x: 0, y: 0 },
											{ x: 10, y: 10 }
										]
									}
								}
							]
						}
					]
				}),
				'book/fonts/test.ttf': fontBytes
			};
			for (const [path, data] of Object.entries(files)) {
				const parts = path.split('/');
				const name = parts.pop()!;
				let parent = dir;
				for (const part of parts) parent = await parent.getDirectoryHandle(part, { create: true });
				const handle = await parent.getFileHandle(name, { create: true });
				const writer = await handle.createWritable();
				await writer.write(typeof data === 'string' ? data : new Uint8Array(data));
				await writer.close();
			}
			const store = new DirectoryComicStore(dir);
			const all = await store.list();
			const local = all.find((c: any) => c.path === 'book/pages/01.png');
			const localBubbles = await local.getBubbles('en');
			const localFont = local.textFont('en', localBubbles[0]);
			const archiveStore = store.archive('book.cbz');
			const pages = await archiveStore.list();
			const a = pages.find((c: any) => c.entryPath === 'pages/01.png');
			const b = pages.find((c: any) => c.entryPath === 'pages/02.png');
			const aBubbles = await a.getBubbles('en');
			const aFont = a.textFont('en', aBubbles[0]);
			const bBubbles = await b.getBubbles('en');
			const loaded = [localFont.family[0], aFont.family[0]].every((f) =>
				document.fonts.check(`24px "${f}"`, 'AB')
			);
			store.dispose();
			return {
				localText: localBubbles[0].text,
				localFont,
				aText: aBubbles[0].text,
				aFont,
				bBubbles,
				loaded,
				languages: b.languages
			};
		},
		{ archive: [...archive], fontBytes: fixtureFont }
	);
	expect(result.localText).toBe('directory sidecar');
	// book.en.bbl targets the directory exactly, rather than the book.cbz shorthand.
	expect(result.localFont.size).toBe(90);
	expect(result.aText).toBe('archive sidecar');
	expect(result.aFont.size).toBe(35);
	expect(result.localFont.family[0]).not.toBe(result.aFont.family[0]);
	expect(result.bBubbles).toEqual([]);
	expect(result.languages).toContain('en');
	expect(result.loaded).toBe(true);
});

// Original deterministic raster, large enough to exercise actual reader coordinates.
function readerPng() {
	const chunk = (type: string, bytes: Buffer) => {
		const header = Buffer.from(type),
			size = Buffer.alloc(4),
			crc = Buffer.alloc(4);
		size.writeUInt32BE(bytes.length);
		crc.writeUInt32BE(crc32(Buffer.concat([header, bytes])));
		return Buffer.concat([size, header, bytes, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(800);
	header.writeUInt32BE(1000, 4);
	header[8] = 8;
	header[9] = 2;
	const row = Buffer.alloc(2401, 240);
	row[0] = 0;
	return [
		...Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk('IHDR', header),
			chunk('IDAT', deflateSync(Buffer.concat(Array(1000).fill(row)))),
			chunk('IEND', Buffer.alloc(0))
		])
	];
}

test('reader renders inherited fonts, keeps SVG styles separate, scales text and retains session overrides', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('dialog', () => {
		throw new Error('Metadata recovery must not prompt');
	});
	await page.addInitScript(
		({ image, fontBytes }) => {
			Object.defineProperty(navigator, 'languages', { value: ['en'] });
			FileSystemHandle.prototype.queryPermission = async () => 'granted';
			Object.defineProperty(window, 'showDirectoryPicker', {
				value: async () => {
					const root = await navigator.storage.getDirectory();
					const dir = await root.getDirectoryHandle('typography', { create: true });
					const bubble = {
						text: 'AB',
						font: { size: 44 },
						style: { fill: 'yellow' },
						shape: {
							type: 'box',
							vs: [
								{ x: 80, y: 80 },
								{ x: 300, y: 200 }
							]
						}
					};
					const files: Record<string, string | number[]> = {
						'book/01.png': image,
						'book/02.png': image,
						'book/fonts/test.ttf': fontBytes,
						'book/album.bbl': JSON.stringify({
							font: { family: ['Fixture', 'serif'], size: 30, style: 'italic', lineHeight: 1.2 },
							fontFaces: [{ family: 'Fixture', src: './fonts/test.ttf' }]
						}),
						'book.en.bbl': JSON.stringify({
							font: { letterSpacing: 2 },
							pages: [{ filename: '02.png', bubbles: [] }]
						}),
						'book/01.png.en.bbl': JSON.stringify({
							font: { weight: 700 },
							pages: [{ font: { style: 'normal' }, bubbles: [bubble] }]
						})
					};
					for (const [path, data] of Object.entries(files)) {
						const parts = path.split('/');
						const name = parts.pop()!;
						let parent = dir;
						for (const part of parts)
							parent = await parent.getDirectoryHandle(part, { create: true });
						const handle = await parent.getFileHandle(name, { create: true });
						const writer = await handle.createWritable();
						await writer.write(typeof data === 'string' ? data : new Uint8Array(data));
						await writer.close();
					}
					return dir;
				}
			});
		},
		{ image: readerPng(), fontBytes: fixtureFont }
	);
	const select = async (name: string, option: string) => {
		await page.getByRole('menuitem', { name, exact: true }).click();
		await page.getByRole('menu', { name, exact: true }).getByText(option, { exact: true }).click();
		const next = option.toUpperCase();
		const menu = page.getByRole('menu', { name: next, exact: true });
		if (await menu.isVisible())
			await page.getByRole('menuitem', { name: next, exact: true }).click();
	};
	await page.goto('./');
	await page.getByRole('button', { name: 'Add folder' }).click();
	await page.getByRole('button', { name: 'Single Page', exact: true }).click();
	await page.getByRole('treeitem', { name: 'book/', exact: true }).press('ArrowRight');
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	const text = page.locator('foreignObject div').first();
	await expect(text).toHaveText('AB');
	await expect(text).toHaveCSS('font-size', '44px');
	await expect(text).toHaveCSS('font-style', 'normal');
	await expect(text).toHaveCSS('font-weight', '700');
	await expect(text).toHaveCSS('letter-spacing', '2px');
	await expect(text).toHaveCSS('line-height', '52.8px');
	await expect(page.locator('g.svgcontent rect')).toHaveCSS('fill', 'rgb(255, 255, 0)');
	expect(await text.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('bbl-face-');
	await select('FIT', '100%');
	const before = await text.boundingBox();
	await select('100%', '200%');
	await expect
		.poll(async () => Math.round(((await text.boundingBox())!.width / before!.width) * 100))
		.toBe(200);
	await expect(text).toHaveCSS('font-size', '44px');
	await select('200%', 'Fit');
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.getByRole('textbox').fill('Edited');
	await page.getByRole('treeitem', { name: /^0?2$/, exact: true }).click();
	await expect(page.locator('foreignObject')).toHaveCount(0);
	await page.getByRole('treeitem', { name: /^0?1$/, exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveText('Edited');
	await expect(page.getByRole('textbox')).toHaveCSS('font-size', '44px');
	const svg = page.getByRole('img', { name: 'Comic page' });
	const box = await svg.boundingBox();
	await page.mouse.move(box!.x + (400 * box!.width) / 800, box!.y + (400 * box!.height) / 1000);
	await page.mouse.down();
	await page.mouse.move(box!.x + (600 * box!.width) / 800, box!.y + (600 * box!.height) / 1000, {
		steps: 5
	});
	await page.mouse.up();
	await expect(page.getByRole('textbox')).toHaveCount(2);
	await expect(page.getByRole('textbox').last()).toHaveCSS('font-size', '30px');
	await expect(page.getByRole('textbox').last()).toHaveCSS('font-style', 'normal');
	expect(errors).toEqual([]);
});
