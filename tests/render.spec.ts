import { test, expect } from '@playwright/test';
import { Comic, BblShapeType, type Bubble } from '../src/lib/types/Comic';
import { isRenderLanguage, prepareRender, renderSize, requestRender } from '../src/lib/render';
import { normalizeAiSettings } from '../src/lib/textCleanup';
import { renderPrompt } from '../src/lib/renderPrompt';
import { png } from './archive-fixtures';

const bubble = (text: string): Bubble => ({
	text,
	shape: {
		type: BblShapeType.box,
		vs: [
			{ x: 0, y: 0 },
			{ x: 40, y: 40 }
		]
	}
});

test('render uses MRG original metadata and exact indexed text, including empty fields', async () => {
	const reads: (string | undefined)[] = [];
	const comic = new Comic('01.jpg', ['en', 'MRG'], {
		list: async () => [],
		getImageUrl: async () => '',
		getBubbles: async (_comic, language) => {
			reads.push(language);
			comic.setSourceLanguage(language!, language === 'MRG' ? 'nl' : 'en');
			return language === 'MRG'
				? [bubble('Hallo\nwereld!'), bubble('')]
				: [bubble('Hello world!'), bubble('')];
		}
	});
	expect(await prepareRender(comic, 'en')).toEqual({
		sourceLanguage: 'nl',
		targetLanguage: 'en',
		items: [
			{ source: 'Hallo\nwereld!', target: 'Hello world!' },
			{ source: '', target: '' }
		]
	});
	expect(reads).toEqual(['MRG', 'en']);
	comic.setBubbles('en', []);
	await expect(prepareRender(comic, 'en')).rejects.toThrow('counts must match');
	for (const language of ['org', 'OCR', 'MRG', '', 'und']) {
		expect(isRenderLanguage(language)).toBe(false);
		await expect(prepareRender(comic, language)).rejects.toThrow('translated language');
	}
});

test('render rejects missing original language and rounds each edge up without changing exact sizes', async () => {
	const comic = new Comic('01.png', ['en', 'OCR'], {
		list: async () => [],
		getImageUrl: async () => '',
		getBubbles: async () => [bubble('text')]
	});
	await expect(prepareRender(comic, 'en')).rejects.toThrow('original language');
	expect(renderSize(801, 1001)).toBe('816x1008');
	expect(renderSize(800, 1008)).toBe('800x1008');
	expect(() => renderSize(0, 100)).toThrow('dimensions');
});

test('render falls back to OCR text and language, matching overlay names case-insensitively', async () => {
	const comic = new Comic('01.jpg', ['en', 'ocr'], {
		list: async () => [],
		getImageUrl: async () => '',
		getBubbles: async (_comic, language) =>
			language === 'ocr' ? [{ ...bubble('Hallo'), lang: 'nl' }] : [bubble('Hello')]
	});
	expect(await prepareRender(comic, 'en')).toEqual({
		sourceLanguage: 'nl',
		targetLanguage: 'en',
		items: [{ source: 'Hallo', target: 'Hello' }]
	});
});

test('render can use OCR language metadata with MRG text and skips mismatched OCR word counts', async () => {
	const comic = new Comic('01.jpg', ['en', 'OCR', 'MRG'], {
		list: async () => [],
		getImageUrl: async () => '',
		getBubbles: async (_comic, language) => {
			if (language === 'OCR') {
				comic.setSourceLanguage('OCR', 'nl');
				return [bubble('Hallo'), bubble('wereld')];
			}
			return [bubble(language === 'MRG' ? 'Hallo wereld' : 'Hello world')];
		}
	});
	expect(await prepareRender(comic, 'en')).toEqual({
		sourceLanguage: 'nl',
		targetLanguage: 'en',
		items: [{ source: 'Hallo wereld', target: 'Hello world' }]
	});
	comic.languages = ['en'];
	await expect(prepareRender(comic, 'en')).rejects.toThrow('OCR or MRG overlay');
});

test('image edits sends multipart original, prompt plus JSON, model, quality, PNG and rounded size', async () => {
	const previous = globalThis.fetch;
	const document = {
		sourceLanguage: 'nl',
		targetLanguage: 'en',
		items: [{ source: 'Hallo\nwereld', target: 'Hello!' }]
	};
	const settings = normalizeAiSettings({
		url: 'https://example.com/v1/chat/completions',
		apiKey: ' secret ',
		render: { model: 'image-model', quality: 'high' }
	});
	try {
		globalThis.fetch = async (url, init) => {
			expect(String(url)).toBe('https://example.com/v1/images/edits');
			expect(init?.headers).toEqual({ Authorization: 'Bearer secret' });
			const form = init!.body as FormData;
			expect(form.get('model')).toBe('image-model');
			expect(form.get('quality')).toBe('high');
			expect(form.get('size')).toBe('816x1008');
			expect(form.get('output_format')).toBe('png');
			expect(form.get('prompt')).toBe(`${renderPrompt}\n${JSON.stringify(document, null, 2)}`);
			expect(await (form.get('image') as Blob).text()).toBe('original bytes');
			return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
		};
		const result = await requestRender(
			document,
			new Blob(['original bytes'], { type: 'image/png' }),
			{ width: 801, height: 1001 },
			settings
		);
		expect(Buffer.from(await result.arrayBuffer())).toEqual(Buffer.from(png));
		for (const body of [{}, { data: [{ b64_json: 'broken' }] }]) {
			globalThis.fetch = async () => Response.json(body);
			await expect(
				requestRender(document, new Blob(), { width: 800, height: 1000 }, settings)
			).rejects.toThrow(/image/i);
		}
		globalThis.fetch = async () => new Response('sensitive provider body', { status: 400 });
		await expect(
			requestRender(document, new Blob(), { width: 800, height: 1000 }, settings)
		).rejects.toThrow('HTTP 400');
	} finally {
		globalThis.fetch = previous;
	}
});
import { type Page } from '@playwright/test';

async function setupRender(page: Page, format: 'png' | 'jpg' | 'webp' = 'png') {
	await page.addInitScript((format) => {
		Object.defineProperty(navigator, 'languages', { value: ['en'] });
		FileSystemHandle.prototype.queryPermission = async () => 'granted';
		FileSystemHandle.prototype.requestPermission = async () => 'granted';
		Object.defineProperty(window, 'showDirectoryPicker', {
			value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('comics')
		});
		localStorage.setItem(
			'comix-sense.ai-settings',
			JSON.stringify({
				url: 'https://render.example/v1',
				render: {
					model: 'image-test',
					format,
					quality: 'high',
					prompt: 'Replace {sourceLanguage} with {targetLanguage}.'
				}
			})
		);
	}, format);
	await page.goto('./');
	await page.evaluate(async () => {
		const dir = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle('comics', { create: true });
		const write = async (name: string, data: string | Blob) => {
			const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
			await stream.write(data);
			await stream.close();
		};
		const canvas = document.createElement('canvas');
		canvas.width = 801;
		canvas.height = 1001;
		const context = canvas.getContext('2d')!;
		context.fillStyle = 'red';
		context.fillRect(0, 0, 801, 1001);
		await write(
			'01.jpg',
			await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg'))
		);
		const bubbles = (text: string) => [
			{
				text,
				shape: {
					type: 'box',
					vs: [
						{ x: 80, y: 80 },
						{ x: 300, y: 180 }
					]
				}
			}
		];
		await write(
			'01.en.bbl',
			JSON.stringify({ lang: 'en', pages: [{ bubbles: bubbles('Hello world!') }] })
		);
		for (const language of ['OCR', 'MRG'])
			await write(
				`01.${language}.bbl`,
				JSON.stringify({ lang: 'nl', pages: [{ bubbles: bubbles('Hallo\nwereld') }] })
			);
	});
	await page.getByRole('button', { name: 'Add folder', exact: true }).click();
	await page.getByRole('treeitem', { name: '01', exact: true }).click();
	await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Render Page', exact: true })).toBeEnabled();
}

async function renderDisk(page: Page) {
	return page.evaluate(async () => {
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('comics');
		const result: Record<string, number[]> = {};
		for await (const entry of dir.values())
			if (entry.kind === 'file')
				result[entry.name] = [...new Uint8Array(await (await entry.getFile()).arrayBuffer())];
		return result;
	});
}

for (const format of ['png', 'jpg', 'webp'] as const) {
	test(`Render saves ${format} beside the original, preserves BBLs and displays it in reading mode`, async ({
		page
	}) => {
		await setupRender(page, format);
		const before = await renderDisk(page);
		const rendered = await page.evaluate((format) => {
			const canvas = document.createElement('canvas');
			canvas.width = 816;
			canvas.height = 1008;
			const context = canvas.getContext('2d')!;
			context.fillStyle = 'blue';
			context.fillRect(0, 0, 816, 1008);
			return canvas.toDataURL(`image/${format === 'jpg' ? 'jpeg' : format}`).split(',')[1];
		}, format);
		let request = '';
		await page.route('https://render.example/v1/images/edits', async (route) => {
			request = route.request().postDataBuffer()!.toString();
			await route.fulfill({ json: { data: [{ b64_json: rendered }] } });
		});
		await page.getByRole('button', { name: 'Render Page', exact: true }).click();
		await expect(page.getByRole('status').filter({ hasText: 'Saved rendered page' })).toBeVisible();
		expect(request).toContain('816x1008');
		expect(request).toContain(`name="output_format"\r\n\r\n${format === 'jpg' ? 'jpeg' : format}`);
		expect(request).toContain('Replace nl with en.');
		expect(request).toContain('Hallo\\nwereld');
		expect(request).toContain('Hello world!');
		const after = await renderDisk(page);
		expect(after[`01.en.${format}`]).toEqual([...Buffer.from(rendered, 'base64')]);
		for (const [name, data] of Object.entries(before)) expect(after[name]).toEqual(data);
		await expect(page.getByRole('button', { name: 'Reading Mode', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(page.locator('[data-page-path] svg').first()).toHaveAttribute('width', '816');
		await page.getByRole('button', { name: 'Edit Mode', exact: true }).click();
		for (const next of ['ORG', 'OCR', 'MRG']) {
			const current = await page.locator('.language-trigger').getAttribute('aria-label');
			await page.getByRole('menuitem', { name: current!, exact: true }).click();
			await page.getByRole('menuitemradio', { name: next, exact: true }).click();
			await expect(page.getByRole('button', { name: 'Render Page', exact: true })).toBeDisabled();
		}
	});
}

test('render cancellation and API failure leave original files untouched', async ({ page }) => {
	await setupRender(page);
	const before = await renderDisk(page);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route('https://render.example/v1/images/edits', async (route) => {
		await gate;
		await route.fulfill({ status: 400, body: 'bad size' }).catch(() => {});
	});
	await page.getByRole('button', { name: 'Render Page', exact: true }).click();
	await expect(page.getByLabel('Elapsed render time')).toHaveText(/Elapsed: [1-9]\d*s/);
	await page.getByRole('button', { name: 'Cancel render', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Render cancelled');
	await expect(page.getByLabel('Elapsed render time')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Edit Mode', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	release();
	expect(await renderDisk(page)).toEqual(before);
	await page.unroute('https://render.example/v1/images/edits');
	await page.route('https://render.example/v1/images/edits', (route) =>
		route.fulfill({ status: 400, body: 'bad size' })
	);
	await page.getByRole('button', { name: 'Render Page', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('HTTP 400');
	await expect(page.getByRole('button', { name: 'Edit Mode', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect(await renderDisk(page)).toEqual(before);
});

test('Render settings retain model, quality and editable prompt when reopening settings', async ({
	page
}) => {
	await setupRender(page);
	await page.route('https://render.example/v1/models', (route) =>
		route.fulfill({ json: { data: [{ id: 'gpt-image-2' }] } })
	);
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
	await page.getByRole('combobox', { name: 'Render model', exact: true }).fill('gpt-image-2');
	await page.getByRole('combobox', { name: 'Quality', exact: true }).fill('');
	await page.getByRole('combobox', { name: 'Quality', exact: true }).click();
	const options = page.getByRole('listbox', { name: 'Quality', exact: true }).getByRole('option');
	await expect(options).toHaveText(['low', 'medium', 'high']);
	await options.filter({ hasText: 'medium' }).click();
	await page.getByRole('combobox', { name: 'Quality', exact: true }).fill('custom-quality');
	await page.getByLabel('Output format', { exact: true }).selectOption('webp');
	await page.getByRole('button', { name: 'Edit render prompt', exact: true }).click();
	await page
		.getByLabel('Instructions', { exact: true })
		.fill('Render {targetLanguage} from {sourceLanguage} exactly.');
	await page.getByRole('button', { name: 'Use prompt', exact: true }).click();
	await page.getByRole('button', { name: 'Save settings', exact: true }).click();
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('comix-sense.ai-settings')!)
	);
	expect(stored.render).toEqual({
		model: 'gpt-image-2',
		quality: 'custom-quality',
		format: 'webp',
		prompt: 'Render {targetLanguage} from {sourceLanguage} exactly.'
	});
	await page.getByRole('button', { name: 'OCR Settings', exact: true }).click();
	await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Render model', exact: true })).toHaveValue(
		'gpt-image-2'
	);
	await expect(page.getByRole('combobox', { name: 'Quality', exact: true })).toHaveValue(
		'custom-quality'
	);
	await expect(page.getByLabel('Output format', { exact: true })).toHaveValue('webp');
	await page.getByRole('button', { name: 'Edit render prompt', exact: true }).click();
	await page.getByRole('button', { name: 'Restore default prompt', exact: true }).click();
	await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(renderPrompt);
});
