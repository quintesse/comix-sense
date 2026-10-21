import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { zipBytes, rarBytes, png, comicEntries } from './archive-fixtures';
const production = !!process.env.TEST_BASE_URL;
const prefix = production ? '/comix-sense' : '';
function workerURL() {
	if (!production) return '/src/lib/archives/archive.worker.ts?worker_file&type=module';
	const folder = 'build/_app/immutable/workers';
	const file = fs
		.readdirSync(folder)
		.find((f) => f.startsWith('archive.worker-') && f.endsWith('.js'));
	if (!file) throw new Error('Production archive worker not found');
	return prefix + '/_app/immutable/workers/' + file;
}
async function decode(page: Page, bytes: Uint8Array, entry?: string) {
	return page.evaluate(
		async ({ bytes, entry, url, prefix }) => {
			return await new Promise<any>((resolve, reject) => {
				const w = new Worker(url, { type: 'module' });
				const timer = setTimeout(() => {
					w.terminate();
					reject(new Error('Decoder timed out'));
				}, 20000);
				w.onerror = (e) => {
					clearTimeout(timer);
					w.terminate();
					reject(new Error(e.message));
				};
				w.onmessage = async ({ data }) => {
					clearTimeout(timer);
					w.terminate();
					if (data.result instanceof Blob)
						data.result = [...new Uint8Array(await data.result.arrayBuffer())];
					resolve(data);
				};
				w.postMessage({
					file: new File([new Uint8Array(bytes)], 'fixture.cbz'),
					path: entry,
					codecBase: prefix + '/codecs/'
				});
			});
		},
		{ bytes: [...bytes], entry, url: workerURL(), prefix }
	);
}
async function setup(page: Page, archives: Record<string, Uint8Array>) {
	await page.addInitScript(
		({ archives }) => {
			FileSystemHandle.prototype.queryPermission = async () =>
				localStorage.getItem('requirePermission') ? 'prompt' : 'granted';
			FileSystemHandle.prototype.requestPermission = async () => {
				localStorage.removeItem('requirePermission');
				return 'granted';
			};
			Object.defineProperty(navigator, 'languages', { value: ['en'] });
			Object.defineProperty(window, 'showDirectoryPicker', {
				value: async () => {
					const root = await navigator.storage.getDirectory();
					const parent = await root.getDirectoryHandle(localStorage.getItem('parent') ?? 'first', {
						create: true
					});
					const dir = await parent.getDirectoryHandle('comics', { create: true });
					for (const [name, bytes] of Object.entries(archives)) {
						const h = await dir.getFileHandle(name, { create: true });
						const w = await h.createWritable();
						await w.write(new Uint8Array(bytes));
						await w.close();
					}
					return dir;
				}
			});
		},
		{ archives: Object.fromEntries(Object.entries(archives).map(([k, v]) => [k, [...v]])) }
	);
	await page.goto('./');
	await page.getByRole('button', { name: 'Add folder' }).click();
}
test('real ZIP stored/deflated metadata, nested paths, overlays and decoder errors', async ({
	page
}) => {
	await page.goto('./');
	for (const level of [0, 6]) {
		const bytes = await zipBytes(comicEntries, { level });
		const listed = await decode(page, bytes);
		expect(listed.error).toBeUndefined();
		expect(listed.result.map((e: any) => e.path)).toEqual([
			'nested/10.png',
			'nested/2.png',
			'z/1.png',
			'nested/2.en.bbl',
			'nested/inner.cbz'
		]);
		expect((await decode(page, bytes, 'nested/2.png')).result).toEqual([...png]);
	}
	expect((await decode(page, new Uint8Array([1, 2, 3]))).error).toMatch(/signature/);
	expect((await decode(page, await zipBytes({}))).result).toEqual([]);
	expect(
		(await decode(page, await zipBytes({ 'x.png': png }, { password: 'secret' }))).error
	).toMatch(/Encrypted/);
	expect((await decode(page, await zipBytes({ '../x.png': png }))).error).toMatch(/Unsafe/);
	expect((await decode(page, await zipBytes({ 'a\\2.png': png, 'a/2.png': png }))).error).toMatch(
		/duplicate/
	);
	const corrupt = await zipBytes();
	corrupt[0] = 0;
	expect((await decode(page, corrupt)).error).toMatch(/signature/);
});
test('real libarchive RAR4, RAR5 and solid RAR backward extraction and cleanup', async ({
	page
}) => {
	await page.goto('./');
	for (const name of [
		'test_read_format_rar.rar',
		'test_read_format_rar5_compressed.rar',
		'test_read_format_rar5_solid.rar'
	]) {
		const bytes = new Uint8Array(fs.readFileSync(path.join('tests/fixtures/archives', name)));
		const listed = await decode(page, bytes);
		expect(listed.error, name).toBeUndefined();
		expect(listed.result.length).toBeGreaterThan(0);
		const first = listed.result[0].path,
			last = listed.result.at(-1).path;
		const a = await decode(page, bytes, last),
			b = await decode(page, bytes, first),
			c = await decode(page, bytes, last);
		expect(a.error).toBeUndefined();
		expect(b.error).toBeUndefined();
		expect(c.result).toEqual(a.result);
		expect(a.result.length).toBe(listed.result.at(-1).size);
		console.log('RAR measurement', name, {
			list: listed.metrics,
			last: a.metrics,
			first: b.metrics,
			repeat: c.metrics
		});
	}
	const encrypted = new Uint8Array(
		fs.readFileSync('tests/fixtures/archives/test_read_format_rar4_encrypted.rar')
	);
	expect((await decode(page, encrypted)).error).toMatch(/Encrypted/);
	const multipart = rarBytes();
	multipart[10] |= 1;
	expect((await decode(page, multipart)).error).toMatch(/Multipart/);
	expect((await decode(page, rarBytes(), 'nested/2.png')).result).toEqual([...png]);
});
test('archive albums open with keyboard, keep natural order across internal folders and restore language/page', async ({
	page
}) => {
	const outbound: string[] = [];
	page.on('request', (r) => {
		if (
			r.method() !== 'GET' ||
			(!r.url().startsWith('http://127.0.0.1') &&
				!r.url().startsWith('blob:') &&
				r.resourceType() !== 'font')
		)
			outbound.push(r.url());
	});
	await setup(page, {
		'issue.cbz': await zipBytes(),
		'old.cbr': rarBytes(),
		'bad.zip': new Uint8Array([1, 2, 3])
	});
	expect(await page.locator('[data-page-path]').count()).toBe(0);
	const album = page.getByRole('treeitem', { name: 'issue', exact: true });
	await album.press('Enter');
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'issue.cbz/nested/2.png'
	);
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	const pane = page.getByRole('region', { name: 'Album pages' });
	await expect(pane.locator('button')).toHaveText(['nested/2.png', 'nested/10.png', 'z/1.png']);
	await expect(
		page.locator('svg').getByText('Archive hello', { exact: true }).last()
	).toBeVisible();
	await pane.getByRole('button', { name: 'z/1.png', exact: true }).click();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'issue.cbz/z/1.png'
	);
	await page.reload();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'issue.cbz/z/1.png'
	);
	await expect(pane.locator('button[aria-current="page"]')).toHaveText('z/1.png');
	await page.getByRole('treeitem', { name: 'bad', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('signature');
	await page.getByRole('treeitem', { name: 'old', exact: true }).click();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'old.cbr/nested/2.png'
	);
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
	expect(outbound).toEqual([]);
});
test('limits enforce declared sizes and actual ZIP output; unsupported compression fails clearly', async ({
	page
}) => {
	await page.goto('./');
	const bytes = await zipBytes({ 'large.png': new Uint8Array(33 * 1024 * 1024) });
	expect((await decode(page, bytes)).error).toMatch(/size limit/);
	const unsupported = await zipBytes({ 'x.png': png }, { level: 0 });
	// Mutate stored compression method in local and central headers.
	for (let i = 0; i < unsupported.length - 10; i++)
		if (unsupported[i] === 0x50 && unsupported[i + 1] === 0x4b) {
			if (unsupported[i + 2] === 3) unsupported[i + 8] = 99;
			if (unsupported[i + 2] === 1) unsupported[i + 10] = 99;
		}
	expect((await decode(page, unsupported, 'x.png')).error).toBeTruthy();
});

test('decoder cache evicts by bytes, deduplicates requests, and cancels/terminates workers', async ({
	page
}) => {
	test.skip(
		production,
		'Direct TypeScript module exercised on development server; production lifecycle covered through UI'
	);
	const bytes = await zipBytes(
		Object.fromEntries(['a', 'b', 'c'].map((n) => [n + '.bin', new Uint8Array(25 * 1024 * 1024)]))
	);
	await page.goto('./');
	const result = await page.evaluate(
		async (bytes) => {
			const { LocalArchiveReader } = await import(
				/* @vite-ignore */ String('/src/lib/archives/LocalArchiveReader.ts')
			);
			const Original = window.Worker;
			let created = 0,
				terminated = 0;
			window.Worker = class extends Original {
				constructor(url: string | URL, options?: WorkerOptions) {
					super(url, options);
					created++;
				}
				terminate() {
					terminated++;
					super.terminate();
				}
			};
			try {
				const reader = new LocalArchiveReader(new File([new Uint8Array(bytes)], 'cache.cbz'));
				await Promise.all([reader.read('a.bin'), reader.read('a.bin')]);
				const duplicate = created;
				await reader.read('b.bin');
				await reader.read('c.bin');
				await reader.read('a.bin');
				const eviction = created;
				await reader.read('a.bin');
				const hit = created;
				reader.dispose();
				let disposed = '';
				try {
					await reader.read('a.bin');
				} catch (e) {
					disposed = String(e);
				}
				const slow = new LocalArchiveReader(new File([new Uint8Array(bytes)], 'cancel.cbz'));
				const pending = slow.list().catch((e: Error) => String(e));
				await new Promise((r) => setTimeout(r, 0));
				slow.cancel();
				const cancelled = await pending;
				slow.dispose();
				return { duplicate, eviction, hit, created, terminated, disposed, cancelled };
			} finally {
				window.Worker = Original;
			}
		},
		[...bytes]
	);
	expect(result.duplicate).toBe(1);
	expect(result.eviction).toBe(4);
	expect(result.hit).toBe(4);
	expect(result.created).toBe(result.terminated);
	expect(result.cancelled).toMatch(/cancelled/);
	expect(result.disposed).toMatch(/disposed/);
});

test('disconnect during indexing cancels workers and cannot select a late archive page', async ({
	page
}) => {
	await setup(page, { 'slow.cbz': await zipBytes() });
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	let intercepted!: () => void;
	const seen = new Promise<void>((resolve) => (intercepted = resolve));
	await page.route('**/*archive.worker*', async (route) => {
		intercepted();
		await gate;
		await route.continue().catch(() => {});
	});
	await page.getByRole('treeitem', { name: 'slow', exact: true }).click();
	await seen;
	await expect(page.getByRole('treeitem', { name: 'slow (loading)', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Disconnect comics' }).click({ force: true });
	await page.getByRole('button', { name: 'Yes', exact: true }).click();
	release();
	await expect(page.getByRole('treeitem')).toHaveCount(0);
	await expect(page.locator('[data-page-path]')).toHaveCount(0);
	await expect(page.getByRole('main')).toContainText('Add a comics source');
});

test('two directory roots retain independent archive pages and language choices', async ({
	page
}) => {
	await setup(page, { 'same.zip': await zipBytes() });
	const root = page.getByRole('treeitem', { name: 'comics/', exact: true });
	await root.first().getByRole('treeitem', { name: 'same', exact: true }).press('ArrowRight');
	await expect(page.getByRole('treeitem', { name: 'nested/2.png', exact: true })).toBeVisible();
	await page.getByRole('treeitem', { name: 'nested/2.png', exact: true }).click();
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await page
		.getByRole('menu', { name: 'EN', exact: true })
		.getByText('ORG', { exact: true })
		.click();
	await page.getByRole('menuitem', { name: 'ORG', exact: true }).click();
	await page
		.getByRole('region', { name: 'Album pages' })
		.getByRole('button', { name: 'z/1.png', exact: true })
		.click();
	await page.evaluate(() => localStorage.setItem('parent', 'second'));
	await page.getByRole('button', { name: 'Add folder' }).click();
	await root.nth(1).getByRole('treeitem', { name: 'same', exact: true }).press('Enter');
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'same.zip/nested/2.png'
	);
	await expect(page.getByRole('menuitem', { name: 'EN', exact: true })).toBeVisible();
	await root.first().getByRole('treeitem', { name: 'same', exact: true }).press('Enter');
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'same.zip/z/1.png'
	);
	await expect(page.getByRole('menuitem', { name: 'ORG', exact: true })).toBeVisible();
});

test('archive text edits survive navigation, missing overlays stay empty and invalid images stay recoverable', async ({
	page
}) => {
	const bad = {
		...comicEntries,
		'zzz/bad.png': new TextEncoder().encode('<html>not a raster</html>')
	};
	await setup(page, { 'edit.cbz': await zipBytes(bad) });
	await page.getByRole('treeitem', { name: 'edit', exact: true }).click();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await page.locator('[contenteditable=true]').fill('Retained archive edit');
	const pane = page.getByRole('region', { name: 'Album pages' });
	await pane.getByRole('button', { name: 'z/1.png', exact: true }).click();
	// The 2P spread includes the deliberately invalid last image.
	await expect(page.getByRole('alert')).toContainText('Invalid raster');
	await pane.getByRole('button', { name: 'nested/2.png', exact: true }).click();
	await expect(page.locator('[contenteditable=true]')).toHaveText('Retained archive edit');
});

test('input and entry-count limits reject without extracting pages', async ({ page }) => {
	await page.goto('./');
	for (const rar of [false, true]) {
		const result = await page.evaluate(
			async ({ url, prefix, rar }) => {
				return await new Promise<any>((resolve, reject) => {
					const worker = new Worker(url, { type: 'module' });
					worker.onmessage = ({ data }) => {
						worker.terminate();
						resolve(data);
					};
					worker.onerror = (e) => reject(new Error(e.message));
					const signature = rar ? [82, 97, 114, 33, 26, 7, 0] : [80, 75, 3, 4];
					const chunk = new Blob([new Uint8Array(1024 * 1024)]);
					const file = new File(
						[new Uint8Array(signature), ...Array(rar ? 33 : 513).fill(chunk)],
						'large'
					);
					worker.postMessage({ file, codecBase: prefix + '/codecs/' });
				});
			},
			{ url: workerURL(), prefix, rar }
		);
		expect(result.error).toMatch(/input size limit/);
	}
	const entries = Object.fromEntries(
		Array.from({ length: 10001 }, (_, i) => [i + '.bin', new Uint8Array()])
	);
	expect((await decode(page, await zipBytes(entries, { level: 0 }))).error).toMatch(/entry count/);
});

test('actual ZIP output limit rejects forged small uncompressed metadata', async ({ page }) => {
	await page.goto('./');
	const bytes = await zipBytes({ 'bomb.bin': new Uint8Array(33 * 1024 * 1024) });
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let i = 0; i < bytes.length - 30; i++) {
		if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1, true);
		if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 1, true);
	}
	const result = await decode(page, bytes, 'bomb.bin');
	expect(result.error).toMatch(/Actual archive output size limit|Invalid uncompressed size/);
});

test('RAR5 links are ignored and encryption rejected', async ({ page }) => {
	await page.goto('./');
	const fixture = (name: string) =>
		new Uint8Array(fs.readFileSync('tests/fixtures/archives/' + name + '.rar'));
	const hard = await decode(page, fixture('test_read_format_rar5_hardlink'));
	expect(hard.error).toBeUndefined();
	expect(hard.result.map((e: any) => e.path)).toEqual(['file.txt']);
	const sym = await decode(page, fixture('test_read_format_rar5_symlink'));
	expect(sym.error).toBeUndefined();
	expect(sym.result.every((e: any) => !e.path.includes('symlink'))).toBe(true);
	expect((await decode(page, fixture('test_read_format_rar5_encrypted'))).error).toMatch(
		/Encrypted/
	);
});

test('known libarchive stored-RAR CRC detection gap (deferred)', async ({ page }) => {
	test.fail(
		true,
		'Deferred at user request: libarchive.js get_filedata misses stored-entry CRC mismatch'
	);
	await page.goto('./');
	const corrupt = rarBytes({ 'page.png': png });
	const start = corrupt.findIndex((v, i) => v === 137 && corrupt[i + 1] === 80);
	corrupt[start + 10] ^= 1;
	expect((await decode(page, corrupt, 'page.png')).error).toBeTruthy();
});

test('archive position and ORG restore after directory permission renewal; missing pages preserve history', async ({
	page
}) => {
	const bytes = await zipBytes();
	await setup(page, { 'history.cbz': bytes });
	await page.getByRole('treeitem', { name: 'history', exact: true }).click();
	await page
		.getByRole('region', { name: 'Album pages' })
		.getByRole('button', { name: 'z/1.png', exact: true })
		.click();
	await page.getByRole('menuitem', { name: 'EN', exact: true }).click();
	await page
		.getByRole('menu', { name: 'EN', exact: true })
		.getByText('ORG', { exact: true })
		.click();
	await page.getByRole('menuitem', { name: 'ORG', exact: true }).click();
	await page.evaluate(() => localStorage.setItem('requirePermission', 'yes'));
	await page.reload();
	await page.getByRole('button', { name: 'Reopen comics', exact: true }).click();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'history.cbz/z/1.png'
	);
	await expect(page.getByRole('menuitem', { name: 'ORG', exact: true })).toBeVisible();
	const replace = async (content: Uint8Array) =>
		page.evaluate(
			async (bytes) => {
				const root = await navigator.storage.getDirectory(),
					parent = await root.getDirectoryHandle('first'),
					dir = await parent.getDirectoryHandle('comics');
				const file = await dir.getFileHandle('history.cbz'),
					w = await file.createWritable();
				await w.write(new Uint8Array(bytes));
				await w.close();
			},
			[...content]
		);
	await replace(await zipBytes({ 'only.png': png }));
	await page.reload();
	await expect(page.getByRole('treeitem', { name: 'history', exact: true })).toBeVisible();
	await expect(page.locator('[data-page-path]')).toHaveCount(0);
	await replace(bytes);
	await page.reload();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'history.cbz/z/1.png'
	);
});

test('empty archive and malformed overlay errors leave adjacent archive albums usable', async ({
	page
}) => {
	await setup(page, {
		'empty.zip': await zipBytes({}),
		'bad.zip': await zipBytes({ '1.png': png, '1.en.bbl': new TextEncoder().encode('{bad JSON') }),
		'good.cbr': rarBytes()
	});
	await page.getByRole('treeitem', { name: 'empty', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('no supported images');
	await page.getByRole('treeitem', { name: 'bad', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Could not read bubbles');
	await page.getByRole('treeitem', { name: 'good', exact: true }).click();
	await expect(page.getByRole('img', { name: 'Comic page' }).first()).toBeVisible();
});

test('mouse expander lazily indexes archive pages', async ({ page }) => {
	await setup(page, { 'expand.cbz': await zipBytes() });
	const archive = page.getByRole('treeitem', { name: 'expand', exact: true });
	await expect(archive.getByRole('treeitem')).toHaveCount(0);
	await archive.locator(':scope > div .bx--tree-parent-node__toggle').click();
	await expect(archive.getByRole('treeitem')).toHaveCount(3);
	await expect(archive.getByRole('treeitem', { name: 'nested/2.png', exact: true })).toBeVisible();
});

test('real decoder preserves protected entries across page eviction and display URL release', async ({
	page
}) => {
	test.skip(production, 'Session cache adapter exercised on development server');
	const bytes = await zipBytes(
		Object.fromEntries(['a', 'b', 'c'].map((n) => [n + '.bin', new Uint8Array(25 * 1024 * 1024)]))
	);
	await page.goto('./');
	const result = await page.evaluate(
		async (bytes) => {
			const { LocalArchiveReader } = await import(
				/* @vite-ignore */ String('/src/lib/archives/LocalArchiveReader.ts')
			);
			const { archiveImageUrl, releaseImageUrl } = await import(
				/* @vite-ignore */ String('/src/lib/ImageUrls.ts')
			);
			const Original = window.Worker;
			let created = 0,
				terminated = 0;
			window.Worker = class extends Original {
				constructor(url: string | URL, options?: WorkerOptions) {
					super(url, options);
					created++;
				}
				terminate() {
					terminated++;
					super.terminate();
				}
			};
			const reader = new LocalArchiveReader(new File([new Uint8Array(bytes)], 'protected.zip'));
			try {
				const release = reader.protect('a.bin');
				const a = await reader.read('a.bin');
				const url = archiveImageUrl(a, 'application/octet-stream');
				releaseImageUrl(url);
				await reader.read('b.bin');
				await reader.read('c.bin');
				await reader.read('a.bin');
				await reader.read('c.bin');
				const before = created;
				release();
				await reader.read('b.bin');
				await reader.read('c.bin');
				const after = created;
				return { before, after, terminated, created };
			} finally {
				reader.dispose();
				window.Worker = Original;
			}
		},
		[...bytes]
	);
	expect(result.before).toBe(3);
	expect(result.after).toBe(4);
	expect(result.terminated).toBe(result.created);
});

test('real shared thumbnail extraction is promoted ahead of pending thumbnails', async ({
	page
}) => {
	test.skip(production, 'Session queue adapter exercised on development server');
	const bytes = await zipBytes({
		'block.bin': png,
		'old.bin': png,
		'shared.bin': png,
		'reader.bin': png
	});
	await page.goto('./');
	const result = await page.evaluate(
		async (bytes) => {
			const { LocalArchiveReader } = await import(
				/* @vite-ignore */ String('/src/lib/archives/LocalArchiveReader.ts')
			);
			const Original = window.Worker;
			const order: string[] = [];
			let release!: () => void, started!: () => void;
			const gate = new Promise<void>((resolve) => (release = resolve)),
				firstStarted = new Promise<void>((resolve) => (started = resolve));
			window.Worker = class extends Original {
				postMessage(message: unknown) {
					const request = message as { path: string };
					order.push(request.path);
					if (request.path === 'block.bin') {
						started();
						void gate.then(() => super.postMessage(message));
					} else super.postMessage(message);
				}
			};
			const reader = new LocalArchiveReader(new File([new Uint8Array(bytes)], 'priority.zip'));
			try {
				const block = reader.read('block.bin', 'thumbnail');
				await firstStarted;
				const thumbnail = reader.read('old.bin', 'thumbnail');
				const low = reader.read('shared.bin', 'thumbnail'),
					high = reader.read('shared.bin', 'reader');
				const foreground = reader.read('reader.bin');
				release();
				await Promise.all([block, thumbnail, low, high, foreground]);
				return { order, shared: (await low) === (await high) };
			} finally {
				reader.dispose();
				window.Worker = Original;
			}
		},
		[...bytes]
	);
	expect(result.order).toEqual(['block.bin', 'shared.bin', 'reader.bin', 'old.bin']);
	expect(result.shared).toBe(true);
});

test('archive album selection preserves expansion until explicitly toggled', async ({ page }) => {
	await setup(page, { 'closed.cbz': await zipBytes() });
	const album = page.getByRole('treeitem', { name: 'closed', exact: true });
	const selected = page.locator('[data-page-path]').first();
	const pane = page.getByRole('region', { name: 'Album pages' });
	await album.click();
	await expect(selected).toHaveAttribute('data-page-path', 'closed.cbz/nested/2.png');
	await expect(album).toHaveAttribute('aria-expanded', 'false');
	await expect(
		album.getByRole('treeitem', { name: 'nested/2.png', exact: true })
	).not.toBeVisible();
	await pane.getByRole('button', { name: 'z/1.png', exact: true }).click();
	await album.click();
	await expect(selected).toHaveAttribute('data-page-path', 'closed.cbz/z/1.png');
	await expect(album).toHaveAttribute('aria-expanded', 'false');
	await album.press('Enter');
	await expect(album).toHaveAttribute('aria-expanded', 'false');
	await album.press('ArrowRight');
	await expect(album).toHaveAttribute('aria-expanded', 'true');
	await expect(album.getByRole('treeitem', { name: 'nested/2.png', exact: true })).toBeVisible();
	await album.click();
	await expect(album).toHaveAttribute('aria-expanded', 'true');
	await album.press('ArrowLeft');
	await expect(album).toHaveAttribute('aria-expanded', 'false');
	await album.click();
	await expect(album).toHaveAttribute('aria-expanded', 'false');
});

test('archive page headings use collection and album while preserving internal paths and overlays', async ({
	page
}) => {
	const names = ['COMICS ✨ Volume — 001.png', 'comics_Volume002.png', 'art/ComicsVolume003.png'];
	const entries: Record<string, Uint8Array> = Object.fromEntries(names.map((name) => [name, png]));
	entries['COMICS ✨ Volume — 001.en.bbl'] = new TextEncoder().encode(
		JSON.stringify({
			pages: [
				{
					bubbles: [
						{
							text: 'Original overlay match',
							shape: {
								type: 'box',
								vs: [
									{ x: 0, y: 0 },
									{ x: 1, y: 1 }
								]
							}
						}
					]
				}
			]
		})
	);
	await setup(page, { 'comics - Volume.cbz': await zipBytes(entries) });
	const album = page.getByRole('treeitem', { name: 'Volume', exact: true });
	await album.click();
	const pane = page.getByRole('region', { name: 'Album pages' });
	await expect(pane.locator('button')).toHaveCount(3);
	expect((await pane.locator('button').allTextContents()).map((label) => label.trim())).toEqual(
		expect.arrayContaining(['001.png', '002.png', 'art/003.png'])
	);
	const first = pane.getByRole('button', { name: '001.png', exact: true });
	await first.click();
	await expect(first).toHaveAttribute('title', names[0]);
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		'comics - Volume.cbz/' + names[0]
	);
	await expect(page.locator('foreignObject').last()).toHaveText('Original overlay match');
	await album.press('ArrowRight');
	await expect(album.getByRole('treeitem', { name: '001.png', exact: true })).toBeVisible();
});

test('shorten the complete archive label including repeated wrapper folders and filename prefixes', async ({
	page
}) => {
	await page.goto('./');
	const bytes = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 2;
		canvas.height = 2;
		const blob = await new Promise<Blob>((resolve) =>
			canvas.toBlob((blob) => resolve(blob!), 'image/webp')
		);
		return [...new Uint8Array(await blob.arrayBuffer())];
	});
	const title = 'Roze Bottel - 00 - De Andere Korte Verhalen (Apirate)';
	const entries: Record<string, Uint8Array> = {};
	for (let i = 0; i < 4; i++) entries[`${title}/RozeB-000${i}.webp`] = new Uint8Array(bytes);
	entries[`${title}/RozeB-0002.en.bbl`] = new TextEncoder().encode(
		JSON.stringify({
			pages: [
				{
					bubbles: [
						{
							text: 'Wrapper overlay',
							shape: {
								type: 'box',
								vs: [
									{ x: 0, y: 0 },
									{ x: 1, y: 1 }
								]
							}
						}
					]
				}
			]
		})
	);
	await setup(page, { [title + '.cbz']: await zipBytes(entries) });
	const album = page.getByRole('treeitem', { name: title, exact: true });
	await album.click();
	const pane = page.getByRole('region', { name: 'Album pages' });
	await expect(pane.locator('button')).toHaveText(['0.webp', '1.webp', '2.webp', '3.webp']);
	await album.press('ArrowRight');
	await expect(album.getByRole('treeitem', { name: '2.webp', exact: true })).toBeVisible();
	await expect(
		album
			.getByRole('treeitem', { name: '2.webp', exact: true })
			.getByText('2.webp', { exact: true })
	).toHaveAttribute('title', `${title}/RozeB-0002.webp`);
	await pane.getByRole('button', { name: '2.webp', exact: true }).click();
	await expect(page.locator('[data-page-path]').first()).toHaveAttribute(
		'data-page-path',
		`${title}.cbz/${title}/RozeB-0002.webp`
	);
	await expect(pane.getByRole('button', { name: '2.webp', exact: true })).toHaveAttribute(
		'title',
		`${title}/RozeB-0002.webp`
	);
	await expect(page.locator('foreignObject').last()).toHaveText('Wrapper overlay');
});
