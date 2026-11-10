import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	baseline,
	baselineBubbles,
	pilotRequests,
	PASSAGE_FILTER_REVISION,
	wordsFromBbl,
	validateVision,
	visionBubbles,
	Ledger,
	RecordedAdapter,
	call,
	cost
} from './core.mjs';

const shape = {
	type: 'box',
	vs: [
		{ x: 10, y: 10 },
		{ x: 100, y: 50 }
	]
};
const page = {
	sourceLanguage: 'en',
	targetLanguage: 'es',
	imageSize: { width: 300, height: 300 },
	words: [
		{ id: 'w0000', text: 'Goodday', lang: 'en', shape },
		{
			id: 'w0001',
			text: 'x',
			lang: 'en',
			shape: {
				type: 'box',
				vs: [
					{ x: 200, y: 200 },
					{ x: 220, y: 220 }
				]
			}
		}
	]
};
const response = () => ({
	sourceLanguage: 'en',
	targetLanguage: 'es',
	passages: [
		{
			id: 'p',
			wordIds: ['w0000'],
			source: 'Good day friend',
			translation: 'Buen día, amigo',
			tokens: [
				{ kind: 'fused', ids: ['w0000'], text: 'Good day', region: null },
				{
					kind: 'missing',
					ids: [],
					text: 'friend',
					region: {
						type: 'box',
						vs: [
							{ x: 105, y: 10 },
							{ x: 180, y: 50 }
						]
					}
				}
			]
		}
	],
	readingOrder: ['p'],
	exclusions: [{ id: 'w0001', reason: 'False artwork OCR' }]
});
test('fused tokens, placed missing words and false detections retain complete accounting', () => {
	const value = response();
	assert.equal(validateVision(value, page), value);
	const bubbles = visionBubbles(value, page);
	assert.equal(bubbles[0].text, 'Buen día, amigo');
	assert.equal(bubbles[0].shape.type, 'poly');
	assert.ok(bubbles[0].shape.vs.some((v) => v.x === 180));
});
for (const [name, mutate, pattern] of [
	['missing ID', (v) => (v.exclusions = []), /Missing OCR IDs/],
	['duplicated ID', (v) => v.exclusions.push({ id: 'w0000', reason: 'duplicate' }), /duplicate/],
	['unknown ID', (v) => (v.exclusions[0].id = 'invented'), /Unknown/],
	['unplaced missing word', (v) => (v.passages[0].tokens[1].region = null), /bounded/],
	['off-page correction', (v) => (v.passages[0].tokens[1].region.vs[1].x = 999), /outside/],
	['reading order omission', (v) => (v.readingOrder = []), /reading order/],
	['unaccounted transcription', (v) => (v.passages[0].source += ' invented'), /transcription/],
	['empty translation', (v) => (v.passages[0].translation = ''), /Empty/],
	['changed language', (v) => (v.targetLanguage = 'fr'), /Language/],
	['extra metadata', (v) => (v.extra = true), /Expected keys/]
])
	test(`reject ${name}`, () => {
		const v = response();
		mutate(v);
		assert.throws(() => visionBubbles(v, page), pattern);
	});
test('source-file IDs include empty OCR and invalid source geometry fails', () => {
	const raw = {
		pages: [
			{
				bubbles: [
					{ text: '', shape },
					{ text: 'same', shape },
					{ text: 'same', shape }
				]
			}
		]
	};
	assert.deepEqual(
		wordsFromBbl(raw, page.imageSize).map((w) => w.id),
		['w0000', 'w0001', 'w0002']
	);
	raw.pages[0].bubbles[0].shape = {
		type: 'poly',
		vs: [
			{ x: 1, y: 1 },
			{ x: 2, y: 2 },
			{ x: 3, y: 3 }
		]
	};
	assert.throws(() => wordsFromBbl(raw, page.imageSize), /Degenerate/);
});
test('baseline invokes production letter filtering and album-relative preparation', async () => {
	const b = await baseline(
		{ ...page, words: [page.words[0], { ...page.words[1], text: '123' }] },
		3
	);
	assert.equal(b.bubbles.length, 1);
	assert.equal(b.document.items[0].id, '/pages/3/bubbles/0');
	assert.equal(b.document.sourceLanguage, 'en');
});
const rates = {
	textInput: 1,
	imageInput: 2,
	output: 3,
	ocr: 0.0015,
	eurPerUsd: 1,
	taxMultiplier: 1
};
const request = { prompt: 'Translate', document: { items: [] } };
const maximum = { textInput: 10000, imageInput: 0, output: 1000, ocr: 0 };
const makeLedger = (cap = 1) =>
	new Ledger(join(mkdtempSync(join(tmpdir(), 'vision-ledger-')), 'ledger.json'), cap, rates);
test('budget refusal occurs before dispatch and rejects invalid costs', async () => {
	const adapter = new RecordedAdapter({});
	const ledger = makeLedger(0.000001);
	await assert.rejects(call(adapter, ledger, 'p', request, maximum, 'delivery'), /Budget refusal/);
	assert.equal(adapter.dispatches, 0);
	assert.equal(ledger.data.entries.length, 0);
	assert.throws(() => cost({ ...maximum, output: -1 }, rates), /Invalid/);
});
test('timeout reservation persists and a retry consumes additional budget', async () => {
	const ledger = makeLedger(0.02),
		adapter = new RecordedAdapter({ p: { timeout: true } });
	await assert.rejects(call(adapter, ledger, 'p', request, maximum, 'delivery'), /timeout/);
	const entry = JSON.parse(readFileSync(ledger.file)).entries[0];
	assert.equal(entry.status, 'billing-uncertain');
	assert.equal(entry.heldMicroEuro, entry.reservedMicroEuro);
	await assert.rejects(call(adapter, ledger, 'p', request, maximum, 'delivery'), /Budget refusal/);
	assert.equal(adapter.dispatches, 1);
});
test('missing usage retains reservation; total billed output is counted; scopes and fresh OCR remain distinct', async () => {
	const ledger = makeLedger();
	const adapter = new RecordedAdapter({
		unknown: { finishReason: 'stop' },
		known: { finishReason: 'stop', usage: { textInput: 100, imageInput: 0, output: 500, ocr: 1 } }
	});
	await call(adapter, ledger, 'unknown', request, maximum, 'delivery', true);
	await call(adapter, ledger, 'known', request, { ...maximum, ocr: 1 }, 'comparison', false);
	assert.equal(ledger.data.entries[0].status, 'billing-uncertain');
	assert.equal(ledger.data.entries[1].usage.output, 500);
	assert.ok(
		ledger.data.entries[1].usageEstimateMicroEuro >= 3100 &&
			ledger.data.entries[1].usageEstimateMicroEuro <= 3101
	);
	assert.equal(ledger.data.entries[1].reusedOcr, false);
	assert.equal(ledger.data.entries[1].measuredChargeEuro, null);
});
test('undersized input reservation refuses dispatch; truncation retains raw record and usage', async () => {
	const ledger = makeLedger(),
		adapter = new RecordedAdapter({
			p: {
				finishReason: 'length',
				usage: { textInput: 100, imageInput: 0, output: 1000, ocr: 0 },
				value: 'broken'
			}
		});
	await assert.rejects(
		call(adapter, ledger, 'p', request, { ...maximum, textInput: 1 }, 'delivery'),
		/byte bound/
	);
	assert.equal(adapter.dispatches, 0);
	let recorded;
	await assert.rejects(
		call(adapter, ledger, 'p', request, maximum, 'delivery', true, (r) => (recorded = r)),
		/Incomplete/
	);
	assert.equal(recorded.value, 'broken');
	assert.equal(ledger.data.entries[0].usage.output, 1000);
});

test('compact passages derive reading order and keep corrections in place', () => {
	const region = response().passages[0].tokens[1].region;
	const v = {
		sourceLanguage: 'en',
		targetLanguage: 'es',
		exclusions: [],
		passages: [
			{ translation: 'Primero', tokens: ['w0001'] },
			{
				translation: 'Segundo',
				tokens: [
					{ id: 'w0000', text: 'Good day' },
					{ text: 'friend', region }
				]
			}
		]
	};
	const bubbles = visionBubbles(v, page, 2);
	assert.deepEqual(
		bubbles.map((b) => b.text),
		['Primero', 'Segundo']
	);
	assert.ok(bubbles[1].shape.vs.some((v) => v.x === 180));
	for (const token of [
		'w0001',
		{ id: 'w0000', ids: ['w0001'], text: 'bad' },
		{ text: 'missing' },
		'unknown'
	])
		assert.throws(() =>
			visionBubbles(
				{ ...v, passages: [v.passages[0], { translation: 'x', tokens: [token] }] },
				page,
				2
			)
		);
	assert.throws(
		() => visionBubbles({ ...v, passages: [v.passages[0]] }, page, 2),
		/Missing OCR IDs/
	);
});

test('vision filters whole corrected passages after accounting in both contracts', () => {
	const numericPage = {
		...page,
		words: [
			{ ...page.words[0], text: '123' },
			{ ...page.words[1], text: 'Hello' }
		]
	};
	for (const numeric of ['123', '…?!', '１２３ ٤٥！']) {
		const value = {
			sourceLanguage: 'en',
			targetLanguage: 'es',
			exclusions: [],
			passages: [
				{ translation: '', tokens: [{ id: 'w0000', text: numeric }] },
				{ translation: 'Hola 45', tokens: ['w0001', { text: '45', region: shape }] }
			]
		};
		const before = structuredClone(value);
		const bubbles = visionBubbles(value, numericPage, 2);
		assert.deepEqual(
			bubbles.map((b) => b.text),
			['Hola 45']
		);
		assert.deepEqual(value, before);
		assert.ok(bubbles[0].shape.vs.some((v) => v.x === 10));
		assert.throws(
			() => visionBubbles({ ...value, passages: [value.passages[1]] }, numericPage, 2),
			/Missing OCR IDs/
		);
		assert.throws(
			() =>
				visionBubbles(
					{ ...value, passages: [value.passages[0], ...value.passages] },
					numericPage,
					2
				),
			/duplicate/
		);
	}
	const legacy = response();
	legacy.passages[0].tokens = [{ kind: 'ocr', ids: ['w0000'], text: '123', region: null }];
	legacy.passages[0].source = '123';
	assert.deepEqual(visionBubbles(legacy, numericPage), []);
	legacy.passages[0].source = '€';
	legacy.passages[0].tokens[0].text = '€';
	legacy.passages[0].translation = '';
	assert.throws(() => visionBubbles(legacy, numericPage), /Empty/);
});

test('new filtering brief preserves sealed requests and all OCR records', () => {
	const prepared = { prompt: 'Baseline', document: {} };
	const p = { ...page, maximum: { baseline: { output: 10 }, vision: { output: 10 } } };
	const legacy = pilotRequests({ responseContract: 2 }, p, prepared, {});
	const revised = pilotRequests(
		{ responseContract: 2, passageFilterRevision: PASSAGE_FILTER_REVISION },
		p,
		prepared,
		{}
	);
	assert.ok(revised.vision.prompt.startsWith(legacy.vision.prompt));
	assert.match(revised.vision.prompt, /Unicode numbers, Unicode punctuation and whitespace/);
	assert.match(revised.vision.prompt, /return an empty translation/);
	assert.deepEqual(revised.vision.document, legacy.vision.document);
	assert.deepEqual(revised.baseline, legacy.baseline);
	assert.throws(
		() => pilotRequests({ passageFilterRevision: 'unknown' }, p, prepared, {}),
		/Unknown passage filter revision/
	);
});

test('paired baseline export uses stable IDs across skipped groups, response order and retries', () => {
	const bubbles = [
		{ text: '123', shape },
		{ text: 'Hello 45', shape: page.words[1].shape },
		{ text: '…', shape },
		{ text: 'World', shape }
	];
	const ids = bubbles.map((_, i) => `/pages/3/bubbles/${i}`);
	const document = {
		sourceLanguage: 'en',
		targetLanguage: 'es',
		items: [
			{ id: ids[1], text: bubbles[1].text },
			{ id: ids[3], text: bubbles[3].text }
		]
	};
	const prepared = { bubbles, bubbleIds: ids, document };
	const reply = {
		...document,
		items: [
			{ id: ids[3], text: 'Mundo' },
			{ id: ids[1], text: 'Hola 45' }
		]
	};
	const exported = baselineBubbles(reply, prepared, 'es');
	assert.deepEqual(
		exported.map((b) => b.text),
		['Hola 45', 'Mundo']
	);
	assert.equal(exported[0].shape, bubbles[1].shape);
	assert.deepEqual(baselineBubbles(reply, prepared, 'es'), exported);
	assert.deepEqual(
		baselineBubbles(
			{ ...document, items: [] },
			{ ...prepared, document: { ...document, items: [] } },
			'es'
		),
		[]
	);
});
