import { test, expect } from '@playwright/test';
import { Comic, BblShapeType, type Bubble } from '../src/lib/types/Comic';
import {
	completionUrl,
	prepareCleanup,
	requestCleanup,
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
	expect(await job.apply(result, () => true)).toBe(1);
	expect(await pages[1].getBubbles('en')).toEqual([{ ...original[0], text: 'Hello!' }]);
	expect((await pages[0].getBubbles('en'))[0].text).toBe('He11o!');
});

test('album cleanup skips missing overlays and resolves the actual MRG language', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, pages, 'MRG');
	expect(job.document.sourceLanguage).toBe('en');
	expect(job.document.items).toHaveLength(1);
});

test('response validation rejects altered contracts before any replacement', async () => {
	const pages = fixture();
	const job = await prepareCleanup(pages, pages, 'en');
	const mutations: ((doc: any) => void)[] = [
		(d) => {
			d.targetLanguage = 'nl';
		},
		(d) => {
			d.extra = true;
		},
		(d) => {
			d.items.pop();
		},
		(d) => {
			d.items.reverse();
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
