import test from 'node:test';
import assert from 'node:assert/strict';
import { wordsFromBbl } from './core.mjs';
import {
	validateSource,
	sourceBubbles,
	sourceOverlayPassages,
	sourcePrompt,
	sourceRequest,
	legacySourcePrompt,
	SOURCE_PROMPT_REVISION
} from './source.mjs';
const box = (x, y, w = 65, h = 30) => ({
	type: 'box',
	vs: [
		{ x, y },
		{ x: x + w, y: y + h }
	]
});
const imageSize = { width: 600, height: 400 };
const texts = ['Hallo.', 'Kom', 'binnen!', 'Waar', 'ben', 'je?', 'Hier!'];
const shapes = [
	box(40, 40),
	box(40, 80),
	box(110, 80, 90),
	box(40, 220),
	box(110, 220),
	box(180, 220),
	box(290, 220)
];
const raw = {
	lang: 'nl',
	pages: [{ bubbles: texts.map((text, i) => ({ text, shape: shapes[i], lang: 'nl' })) }]
};
const page = { sourceLanguage: 'nl', imageSize, words: wordsFromBbl(raw, imageSize) };
const response = () => ({
	sourceLanguage: 'nl',
	passages: [
		{ tokens: ['w0000', 'w0001', 'w0002'] }, // Two sentences, two rows, one container.
		{ tokens: ['w0003', 'w0004', 'w0005'] },
		{ tokens: ['w0006'] } // Touching containers.
	],
	exclusions: []
});

test('source contract preserves sentences together and adjacent balloons separately in order', () => {
	const mapping = validateSource(response(), page);
	assert.deepEqual(
		mapping.passages.map((p) => p.source),
		['Hallo. Kom binnen!', 'Waar ben je?', 'Hier!']
	);
	assert.deepEqual(
		mapping.passages.map((p) => p.wordIds),
		[['w0000', 'w0001', 'w0002'], ['w0003', 'w0004', 'w0005'], ['w0006']]
	);
	assert.match(sourcePrompt, /one passage per visible speech balloon/);
	assert.match(sourcePrompt, /First identify the panels and their page reading order/);
	assert.match(sourcePrompt, /Finish all lettering in the current panel/);
	assert.match(sourcePrompt, /Do not interleave words from neighboring containers/);
	assert.doesNotMatch(sourcePrompt, /Zaai|Schanulleke|Jerom|Wiske|grenade/i);
});

test('prompt revisions preserve legacy requests and never change the shared accounting stage', () => {
	const manifest = { maximum: { output: 4096 } };
	const legacy = sourceRequest(manifest, page, {});
	const revised = sourceRequest(
		{ ...manifest, sourcePromptRevision: SOURCE_PROMPT_REVISION },
		page,
		{}
	);
	assert.equal(legacy.prompt, legacySourcePrompt);
	assert.equal(revised.prompt, sourcePrompt);
	assert.equal(legacy.stage, revised.stage);
	assert.deepEqual(legacy.document, revised.document);
	assert.deepEqual(legacy.config, revised.config);
	assert.throws(
		() => sourceRequest({ ...manifest, sourcePromptRevision: 'unknown' }, page, {}),
		/Unknown source prompt revision/
	);
});
for (const [name, mutate] of [
	['omitted ID', (v) => v.passages.pop()],
	['duplicate ID', (v) => v.passages[0].tokens.push('w0003')],
	['unknown ID', (v) => v.passages[0].tokens.push('w9999')],
	['invalid correction', (v) => (v.passages[0].tokens[0] = { id: 'w0000', text: '' })],
	['invalid correction type', (v) => (v.passages[0].tokens[0] = { id: 'w0000', text: 5 })],
	[
		'extra correction fields',
		(v) => (v.passages[0].tokens[0] = { id: 'w0000', text: 'Hallo', ids: [] })
	],
	[
		'off-page missing word',
		(v) => v.passages[0].tokens.push({ text: 'vriend', region: box(599, 20) })
	],
	['reversed box', (v) => v.passages[0].tokens.push({ text: 'vriend', region: box(40, 20, -10) })],
	[
		'unreasoned exclusion',
		(v) => {
			v.passages.pop();
			v.exclusions.push({ id: 'w0006', reason: '' });
		}
	],
	['wrong language', (v) => (v.sourceLanguage = 'en')],
	['translation field', (v) => (v.passages[0].translation = 'Hello')]
])
	test(`source rejects ${name}`, () => {
		const v = response();
		mutate(v);
		assert.throws(() => validateSource(v, page));
	});

test('explicit fused corrections, bounded missing words and reasoned exclusions are traceable', () => {
	const v = response();
	v.passages[0].tokens[0] = { id: 'w0000', text: 'Goede dag.' };
	v.passages[0].tokens.push({ text: 'vriend!', region: box(180, 80) });
	v.passages.pop();
	v.exclusions.push({ id: 'w0006', reason: 'Visually confirmed decorative stroke' });
	const m = validateSource(v, page);
	assert.equal(m.passages[0].source, 'Goede dag. Kom binnen! vriend!');
	assert.equal(m.passages[0].tokens[0].ids[0], 'w0000');
	assert.equal(m.passages[0].tokens.at(-1).kind, 'missing');
});

test('source filtering keeps full validated accounting and numeric tokens inside prose', () => {
	const v = response();
	v.passages[0].tokens = [
		{ id: 'w0000', text: '１２３' },
		{ id: 'w0001', text: '…' },
		{ id: 'w0002', text: '٤٥' }
	];
	v.passages[1].tokens[1] = { id: 'w0004', text: '123' };
	const mapping = validateSource(v, page);
	assert.equal(mapping.passages.length, 3);
	assert.deepEqual(
		sourceOverlayPassages(mapping).map((p) => p.id),
		['p2', 'p3']
	);
	assert.deepEqual(
		sourceBubbles(mapping, page).map((b) => b.text),
		['Waar 123 je?', 'Hier!']
	);
	assert.deepEqual(mapping.passages[0].wordIds, ['w0000', 'w0001', 'w0002']);
	v.passages.shift();
	assert.throws(() => validateSource(v, page), /Missing OCR IDs/);
});
