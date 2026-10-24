import { test, expect } from '@playwright/test';
import { Comic, BblShapeType, type Bubble } from '../src/lib/types/Comic';
import {
	completionUrl,
	normalizeAiSettings,
	discoverModels,
	prepareCleanup,
	requestCleanup,
	requestTranslation,
	resolveSourceLanguage,
	validateCleanup,
	type CleanupDocument
} from '../src/lib/textCleanup';

function fixture() {
	const bubble: Bubble = {
		text: 'He11o!',
		lang: 'en',
		shape: {
			type: BblShapeType.box,
			vs: [
				{ x: 1, y: 2 },
				{ x: 30, y: 40 }
			]
		},
		style: { fill: 'red' }
	};
	const store = {
		list: async () => [],
		getImageUrl: async () => '',
		getBubbles: async () => [structuredClone(bubble)]
	};
	return [
		new Comic('album/01.png', ['en', 'MRG'], store),
		new Comic('album/02.png', ['en'], store)
	];
}

test('AI settings migrate a shared model to independent task settings and retain custom prompts', () => {
	const migrated = normalizeAiSettings({
		url: 'https://example.com/v1',
		apiKey: 'secret',
		model: 'shared'
	});
	expect(migrated).toEqual({
		url: 'https://example.com/v1',
		apiKey: 'secret',
		cleanup: { model: 'shared' },
		translation: { model: 'shared' }
	});
	const customized = normalizeAiSettings({
		...migrated,
		cleanup: { model: 'cleanup', prompt: 'Clean {sourceLanguage}' },
		translation: { model: 'translator' }
	});
	expect(customized.cleanup.prompt).toBe('Clean {sourceLanguage}');
	expect(customized.translation).toEqual({ model: 'translator' });
	expect(
		normalizeAiSettings({ cleanup: { model: null, prompt: '  ' }, translation: false }).cleanup
	).toEqual({ model: '' });
});

test('each AI task sends its own model and expanded prompt while retaining the shared schema', async () => {
	const originalFetch = globalThis.fetch;
	const document: CleanupDocument = { sourceLanguage: 'en', targetLanguage: 'fr', items: [] };
	const settings = normalizeAiSettings({
		url: 'https://example.com/v1',
		cleanup: { model: 'cleaner', prompt: 'Clean {sourceLanguage} / {targetLanguage}' },
		translation: { model: 'translator', prompt: 'Translate {sourceLanguage} into {targetLanguage}' }
	});
	const requests: any[] = [];
	try {
		globalThis.fetch = async (_url, init) => {
			requests.push(JSON.parse(init!.body as string));
			return new Response(
				JSON.stringify({
					choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(document) } }]
				})
			);
		};
		await requestCleanup(document, settings);
		await requestTranslation(document, settings);
		expect(requests.map((r) => [r.model, r.messages[0].content])).toEqual([
			['cleaner', 'Clean en / fr'],
			['translator', 'Translate en into fr']
		]);
		for (const request of requests) expect(request.response_format.json_schema.strict).toBe(true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('model discovery uses the provider models URL and key and returns unique valid model IDs', async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = async (url, init) => {
			expect(String(url)).toBe('https://example.com/api/v1/models');
			expect(init?.headers).toEqual({ Authorization: 'Bearer secret' });
			return new Response(
				JSON.stringify({
					data: [
						{ id: 'z-model' },
						{ id: 'a-model' },
						{ id: 'z-model' },
						{ id: 42 },
						{},
						null,
						{ id: '' }
					]
				})
			);
		};
		for (const url of [
			'https://example.com/api/v1/',
			'https://example.com/api/v1/chat/completions'
		])
			expect(await discoverModels({ url, apiKey: ' secret ' })).toEqual(['a-model', 'z-model']);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('model discovery failures, malformed responses and cancellation leave suggestions empty', async () => {
	const originalFetch = globalThis.fetch;
	try {
		for (const response of [
			new Response('{}', { status: 401 }),
			new Response('not json'),
			new Response('{"data":{}}')
		]) {
			globalThis.fetch = async () => response;
			expect(await discoverModels({ url: 'https://example.com/v1', apiKey: '' })).toEqual([]);
		}
		globalThis.fetch = async () => {
			throw new TypeError('Network or CORS failure');
		};
		expect(await discoverModels({ url: 'https://example.com/v1', apiKey: '' })).toEqual([]);
		const controller = new AbortController();
		controller.abort();
		globalThis.fetch = async (_url, init) => {
			init!.signal!.throwIfAborted();
			return new Response('{}');
		};
		expect(
			await discoverModels({ url: 'https://example.com/v1', apiKey: '' }, controller.signal)
		).toEqual([]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('page IDs use album indexes; applying a complete result only replaces text', async () => {
	const pages = fixture();
	const original = structuredClone(await pages[1].getBubbles('en'));
	const job = await prepareCleanup(pages, [pages[1]], 'en');
	expect(job.document).toEqual({
		sourceLanguage: 'en',
		targetLanguage: 'en',
		items: [{ id: '/pages/1/bubbles/0', text: 'He11o!' }]
	});
	const result = structuredClone(job.document);
	result.items[0].text = 'Hello!';
	expect(await job.apply(result, () => true)).toEqual({ changed: 1, missingIds: [] });
	expect(await pages[1].getBubbles('en')).toEqual([{ ...original[0], text: 'Hello!' }]);
	expect((await pages[0].getBubbles('en'))[0].text).toBe('He11o!');
});

test('album cleanup skips missing overlays and resolves the actual MRG language', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, pages, 'MRG');
	expect(job.document.sourceLanguage).toBe('en');
	expect(job.document.items).toHaveLength(1);
});

test('source language uses translation codes, then declared BBL language for OCR/MRG, then bubble metadata', async () => {
	const pages = fixture();
	pages[0].setSourceLanguage('MRG', 'nl');
	const job = await prepareCleanup(pages, [pages[0]], 'MRG', 'fr');
	expect(job.document.sourceLanguage).toBe('nl');
	expect(resolveSourceLanguage('fr', [{ bubbles: [], declaredLanguage: 'nl' }])).toBe('fr');
	expect(resolveSourceLanguage('OCR', [{ bubbles: [], declaredLanguage: 'NL' }])).toBe('nl');
	expect(resolveSourceLanguage('OCR', [{ bubbles: await pages[0].getBubbles('en') }])).toBe('en');
	expect(resolveSourceLanguage('MRG', [{ bubbles: [] }])).toBe('und');
	expect(resolveSourceLanguage('MRG', [{ bubbles: [], declaredLanguage: 'und' }])).toBe('und');
	expect(
		resolveSourceLanguage('MRG', [
			{ bubbles: [], declaredLanguage: 'en' },
			{ bubbles: [], declaredLanguage: 'nl' }
		])
	).toBe('und');
});

test('translation copies source geometry independently and registers a new target overlay', async () => {
	const pages = fixture();
	const source = structuredClone(await pages[1].getBubbles('en'));
	const job = await prepareCleanup(pages, [pages[1]], 'en', 'fr');
	expect(job.document).toEqual({
		sourceLanguage: 'en',
		targetLanguage: 'fr',
		items: [{ id: '/pages/1/bubbles/0', text: 'He11o!' }]
	});
	await job.apply(
		{ ...job.document, items: [{ id: '/pages/1/bubbles/0', text: 'Bonjour !' }] },
		() => true
	);
	expect(pages[1].languages).toContain('fr');
	const translated = await pages[1].getBubbles('fr');
	expect(translated).toEqual([{ ...source[0], text: 'Bonjour !', lang: 'fr' }]);
	translated[0].shape.vs[0].x = 999;
	translated[0].style!.fill = 'blue';
	expect(await pages[1].getBubbles('en')).toEqual(source);
	expect(pages[0].languages).not.toContain('fr');
});

test('translation rejects stale target edits and never creates a target from an empty result', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, [pages[0]], 'MRG', 'fr');
	expect(job.document.sourceLanguage).toBe('en');
	await expect(job.apply({ ...job.document, items: [] }, () => true)).rejects.toThrow('IDs');
	expect(pages[0].languages).not.toContain('fr');
	pages[0].languages.push('fr');
	pages[0].setBubbles('fr', [{ ...(await pages[0].getBubbles('en'))[0], text: 'Old French' }]);
	const overwrite = await prepareCleanup(pages, [pages[0]], 'en', 'fr');
	(await pages[0].getBubbles('fr'))[0].text = 'Manual French edit';
	await expect(overwrite.apply(overwrite.document, () => true)).rejects.toThrow('text changed');
	expect((await pages[0].getBubbles('fr'))[0].text).toBe('Manual French edit');
});

test('partial translation is rejected without changing any existing target bubbles', async () => {
	const pages = fixture();
	const source = await pages[0].getBubbles('en');
	pages[0].setBubbles('en', [...source, { ...source[0], text: 'Second source' }]);
	pages[0].languages.push('fr');
	pages[0].setBubbles('fr', [
		{ ...source[0], text: 'Ancien', lang: 'fr' },
		{ ...source[0], text: 'Deuxième', lang: 'fr' }
	]);
	const job = await prepareCleanup(pages, [pages[0]], 'en', 'fr');
	await expect(
		job.apply(
			{ ...job.document, items: [{ id: '/pages/0/bubbles/1', text: 'Nouveau' }] },
			() => true
		)
	).rejects.toThrow('IDs');
	expect((await pages[0].getBubbles('fr')).map((b) => b.text)).toEqual(['Ancien', 'Deuxième']);
});

test('translation uses the shared strict schema with a translation prompt and distinct target language', async () => {
	const originalFetch = globalThis.fetch;
	const job = await prepareCleanup(fixture(), [], 'en', 'fr');
	try {
		globalThis.fetch = async (_url, init) => {
			const body = JSON.parse(init!.body as string);
			expect(body.messages[0].content).toContain('professional comic-book translator');
			expect(body.messages[0].content).toContain('from en to fr');
			expect(body.messages[0].content).toContain('from en into fr');
			expect(body.messages[0].content).not.toMatch(/\{(?:sourceLanguage|targetLanguage)\}/);
			expect(JSON.parse(body.messages[1].content)).toEqual(job.document);
			expect(body.response_format.json_schema.schema.properties.targetLanguage.enum).toEqual([
				'fr'
			]);
			const itemsSchema = body.response_format.json_schema.schema.properties.items;
			expect(itemsSchema.minItems).toBe(0);
			expect(itemsSchema.maxItems).toBe(0);
			expect(itemsSchema.items.properties.id.enum).toBeUndefined();
			return new Response(
				JSON.stringify({
					choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(job.document) } }]
				})
			);
		};
		expect(
			await requestTranslation(job.document, {
				url: 'https://example.com/v1',
				model: 'test',
				apiKey: ''
			})
		).toEqual(job.document);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('reordered response items update their bubbles by ID across pages', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, pages, 'en');
	const result = {
		...job.document,
		items: [
			{ id: '/pages/1/bubbles/0', text: 'Second page corrected' },
			{ id: '/pages/0/bubbles/0', text: 'First page corrected' }
		]
	};
	expect(await job.apply(result, () => true)).toEqual({ changed: 2, missingIds: [] });
	expect((await pages[0].getBubbles('en'))[0].text).toBe('First page corrected');
	expect((await pages[1].getBubbles('en'))[0].text).toBe('Second page corrected');
});

test('partial cleanup is rejected before changing any bubbles', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, pages, 'en');
	const result = {
		...job.document,
		items: [{ id: '/pages/1/bubbles/0', text: 'Corrected second page' }]
	};
	expect(() => validateCleanup(result, job.document)).toThrow('IDs');
	await expect(job.apply(result, () => true)).rejects.toThrow('IDs');
	expect((await pages[0].getBubbles('en'))[0].text).toBe('He11o!');
	expect((await pages[1].getBubbles('en'))[0].text).toBe('He11o!');
});

test('empty cleanup result is rejected and leaves every bubble unchanged', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, pages, 'en');
	await expect(job.apply({ ...job.document, items: [] }, () => true)).rejects.toThrow('IDs');
	for (const page of pages) expect((await page.getBubbles('en'))[0].text).toBe('He11o!');
});

test('response validation rejects altered contracts before any replacement', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, pages, 'en');
	const mutations: ((doc: any) => void)[] = [
		(d) => {
			delete d.items[0].id;
		},
		(d) => {
			d.targetLanguage = 'nl';
		},
		(d) => {
			d.extra = true;
		},
		(d) => {
			d.items[0].id = '/pages/999/bubbles/0';
		},
		(d) => {
			d.items[1].id = d.items[0].id;
		},
		(d) => {
			d.items[0].text = 42;
		},
		(d) => {
			d.items[0].shape = {};
		}
	];
	for (const mutate of mutations) {
		const result = structuredClone(job.document);
		mutate(result);
		await expect(job.apply(result, () => true)).rejects.toThrow('structure');
	}
	expect((await pages[0].getBubbles('en'))[0].text).toBe('He11o!');
	const empty: CleanupDocument = {
		sourceLanguage: 'en',
		targetLanguage: 'en',
		items: [{ id: '/pages/0/bubbles/0', text: '' }]
	};
	expect(() =>
		validateCleanup({ ...empty, items: [{ ...empty.items[0], text: 'invented' }] }, empty)
	).toThrow();
});

test('rejected responses log the reason and full documents for inspection', () => {
	const original: CleanupDocument = {
		sourceLanguage: 'en',
		targetLanguage: 'fr',
		items: [
			{ id: 'dialogue', text: 'Hello!' },
			{ id: 'empty', text: '' }
		]
	};
	const cases: [unknown, string][] = [
		[{ ...original, extra: true }, 'exactly sourceLanguage, targetLanguage and items'],
		[{ ...original, sourceLanguage: 'nl' }, 'sourceLanguage must equal en'],
		[{ ...original, targetLanguage: 'nl' }, 'targetLanguage must equal fr'],
		[{ ...original, items: {} }, 'items must be an array'],
		[{ ...original, items: [{ id: 'dialogue' }] }, 'items[0] must contain exactly id and text'],
		[{ ...original, items: [{ id: 42, text: 'Bonjour!' }] }, 'items[0].id must be a string'],
		[{ ...original, items: [{ id: 'dialogue', text: 42 }] }, 'items[0].text must be a string'],
		[{ ...original, items: [{ id: 'unknown', text: 'Bonjour!' }] }, 'unknown ID: unknown'],
		[
			{ ...original, items: [{ id: 'dialogue,', text: 'Bonjour!' }, original.items[1]] },
			'unknown ID: dialogue,'
		],
		[{ ...original, items: [original.items[0]] }, 'missing IDs: empty'],
		[{ ...original, items: [] }, 'missing IDs: dialogue, empty'],
		[
			{ ...original, items: [original.items[0], original.items[0]] },
			'items[1] repeats ID: dialogue'
		],
		[{ ...original, items: [{ id: 'empty', text: 'Invented' }] }, 'changed an empty source text']
	];
	const originalError = console.error;
	const logs: unknown[][] = [];
	try {
		console.error = (...args) => logs.push(args);
		for (const [returned, reason] of cases) {
			expect(() => validateCleanup(returned, original)).toThrow('No text was replaced.');
			expect(logs.at(-1)).toEqual([
				'AI response validation failed:',
				{
					reason: expect.stringContaining(reason),
					expectedDocument: original,
					returnedDocument: returned
				}
			]);
		}
		expect(logs).toHaveLength(cases.length);
		validateCleanup(original, original);
		validateCleanup({ ...original, items: [] }, { ...original, items: [] });
		expect(logs).toHaveLength(cases.length);
	} finally {
		console.error = originalError;
	}
});

test('concurrent edits, disconnection and cancellation abort the whole album', async () => {
	for (const condition of ['edit', 'replace', 'disconnect', 'cancel']) {
		const pages = fixture();
		const job = await prepareCleanup(pages, pages, 'en');
		const result = structuredClone(job.document);
		result.items.forEach((item) => {
			item.text = 'Hello!';
		});
		if (condition === 'edit') (await pages[1].getBubbles('en'))[0].text = 'Manual edit';
		if (condition === 'replace') pages[1].setBubbles('en', []);
		const controller = new AbortController();
		if (condition === 'cancel') controller.abort();
		await expect(
			job.apply(result, () => condition !== 'disconnect', controller.signal)
		).rejects.toThrow();
		expect((await pages[0].getBubbles('en'))[0].text).toBe('He11o!');
	}
});

test('provider URL accepts base or complete endpoints and rejects unsafe credentials', () => {
	expect(completionUrl('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
	expect(completionUrl('http://localhost:1234/v1/chat/completions')).toBe(
		'http://localhost:1234/v1/chat/completions'
	);
	for (const url of [
		'file:///tmp/foo',
		'https://user:secret@example.com',
		'https://example.com?key=secret'
	])
		expect(() => completionUrl(url)).toThrow();
});

test('HTTP failures, truncated output and invalid JSON do not yield cleanup results', async () => {
	const originalFetch = globalThis.fetch;
	const job = await prepareCleanup(fixture(), [], 'en');
	try {
		for (const [status, body] of [
			[401, {}],
			[200, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }],
			[200, { choices: [{ message: { content: '```json\n{}\n```' } }] }]
		] as const) {
			globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
			await expect(
				requestCleanup(job.document, {
					url: 'https://example.com/v1',
					model: 'test',
					apiKey: 'secret'
				})
			).rejects.toThrow();
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('cleanup sends strict JSON Schema and still validates IDs in the response', async () => {
	const originalFetch = globalThis.fetch;
	const job = await prepareCleanup(fixture(), [], 'en');
	job.document.items.push({ id: '/pages/0/bubbles/0', text: 'Hello {targetLanguage}' });
	job.document.items.push({ id: '/pages/1/bubbles/0', text: 'Second page' });
	try {
		globalThis.fetch = async (_url, init) => {
			const request = JSON.parse(init!.body as string);
			expect(request.messages[0].content).toContain('comic lettering in en');
			expect(request.messages[0].content).toContain('NEVER translate');
			expect(request.messages[0].content).not.toMatch(/\{(?:sourceLanguage|targetLanguage)\}/);
			expect(JSON.parse(request.messages[1].content)).toEqual(job.document);
			expect(request.response_format.type).toBe('json_schema');
			expect(request.response_format.json_schema.strict).toBe(true);
			const schema = request.response_format.json_schema.schema;
			expect(schema.required).toEqual(['sourceLanguage', 'targetLanguage', 'items']);
			expect(schema.additionalProperties).toBe(false);
			expect(schema.properties.sourceLanguage.enum).toEqual(['en']);
			expect(schema.properties.targetLanguage.enum).toEqual(['en']);
			expect(schema.properties.items.minItems).toBe(2);
			expect(schema.properties.items.maxItems).toBe(2);
			expect(schema.properties.items.items).toEqual({
				type: 'object',
				properties: {
					id: { type: 'string', enum: ['/pages/0/bubbles/0', '/pages/1/bubbles/0'] },
					text: { type: 'string' }
				},
				required: ['id', 'text'],
				additionalProperties: false
			});
			// A provider can ignore schema constraints, so local validation remains necessary.
			return new Response(
				JSON.stringify({
					choices: [
						{
							finish_reason: 'stop',
							message: {
								content: JSON.stringify({
									...job.document,
									items: [{ id: '/pages/9/bubbles/9', text: 'Wrong bubble' }]
								})
							}
						}
					]
				})
			);
		};
		await expect(
			requestCleanup(job.document, { url: 'https://example.com/v1', model: 'test', apiKey: '' })
		).rejects.toThrow('IDs');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('schema rejection does not retry without schema; refusal never applies text', async () => {
	const originalFetch = globalThis.fetch;
	const document: CleanupDocument = { sourceLanguage: 'und', targetLanguage: 'und', items: [] };
	const settings = { url: 'https://example.com/v1', model: 'test', apiKey: '' };
	try {
		let requests = 0;
		globalThis.fetch = async () => {
			requests++;
			return new Response('{}', { status: 400 });
		};
		await expect(requestCleanup(document, settings)).rejects.toThrow('strict JSON Schema');
		expect(requests).toBe(1);
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							finish_reason: 'stop',
							message: {
								refusal: 'Declined',
								content: JSON.stringify(document)
							}
						}
					]
				})
			);
		await expect(requestCleanup(document, settings)).rejects.toThrow('declined');
	} finally {
		globalThis.fetch = originalFetch;
	}
});
