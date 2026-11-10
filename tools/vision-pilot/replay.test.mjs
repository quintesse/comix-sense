import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { AlbumMetadata } from '../../src/lib/bbl/AlbumMetadata.ts';
import { demo } from './demo.mjs';
import { prepareSource, runSource, main } from './source-run.mjs';
import { save, json, hash } from './core.mjs';
import { assembleEnclosedWords, mergeBubbles } from '../../src/lib/mergeBubbles.ts';

const box = (x, y, w = 90, h = 30) => ({
	type: 'box',
	vs: [
		{ x, y },
		{ x: x + w, y: y + h }
	]
});
test('row reconstruction accepts independently established membership without changing automatic grouping', () => {
	const words = [
		{ text: 'second', shape: box(20, 70) },
		{ text: 'first', shape: box(20, 20) },
		{ text: 'row', shape: box(220, 20) }
	];
	const original = structuredClone(words);
	const automatic = mergeBubbles(words);
	const group = assembleEnclosedWords(words);
	assert.deepEqual(
		group.rows.map((r) => r.text),
		['first row', 'second']
	);
	assert.deepEqual(
		group.rows.map((r) => r.sourceIndexes),
		[[1, 2], [0]]
	);
	assert.deepEqual(words, original);
	assert.deepEqual(mergeBubbles(words), automatic);
	assert.throws(() => assembleEnclosedWords([]), /at least one word/);
});

test('synthetic paired rehearsal validates exports, missing IDs, budget refusal and frozen inputs', async () => {
	const summary = await demo(mkdtempSync(resolve(tmpdir(), 'vision-rehearsal-')));
	assert.equal(summary.actualSpendEuro, 0);
	assert.equal(summary.checks.length, 5);
});

test('source replay exports the same retained passage IDs and preserves full source accounting', async () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'source-replay-'));
	const image = resolve(dir, 'invented.png'),
		ocr = resolve(dir, 'invented.OCR.bbl');
	const browser = await chromium.launch({
		channel: process.platform === 'win32' ? 'msedge' : undefined
	});
	try {
		const tab = await browser.newPage({ viewport: { width: 400, height: 200 } });
		await tab.setContent(
			'<style>body{margin:0}</style><svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="white"/><text x="20" y="45" font-size="24">Hello 45</text><text x="20" y="125" font-size="24">123</text></svg>'
		);
		await tab.screenshot({ path: image });
	} finally {
		await browser.close();
	}

	save(ocr, {
		pages: [
			{
				bubbles: [
					{ text: 'Hello', shape: box(20, 20) },
					{ text: '45', shape: box(120, 20, 40) },
					{ text: '123', shape: box(20, 100) }
				]
			}
		]
	});
	const prepared = prepareSource(image, ocr, 'en', dir, { width: 400, height: 200 });
	const manifest = resolve(prepared, 'manifest.json');
	const records = resolve(dir, 'recordings.json');
	save(records, {
		'page:source': {
			finishReason: 'stop',
			value: {
				sourceLanguage: 'en',
				passages: [{ tokens: ['w0000', 'w0001'] }, { tokens: ['w0002'] }],
				exclusions: []
			}
		}
	});
	const result = await runSource(manifest, records, dir);
	assert.equal(result.report.status, 'complete', result.report.error);
	assert.equal(result.report.networkDispatches, 0);
	assert.equal(result.report.inputsUnchanged, true);
	assert.deepEqual(result.report.overlayPassageIds, ['p1']);
	assert.deepEqual(result.report.skippedPassageIds, ['p2']);
	const mapping = json(resolve(result.out, 'passage-token-mapping.json'));
	assert.equal(mapping.passages.length, 2);
	const bubbles = json(resolve(result.report.album, 'invented.MRG.bbl')).pages[0].bubbles;
	assert.deepEqual(
		bubbles.map((b) => b.text),
		['Hello 45']
	);
	assert.equal(hash(resolve(result.report.album, 'invented.png')), hash(image));
	const metadata = new AlbumMetadata(
		async (path) => new Blob([readFileSync(resolve(result.report.album, path))])
	);
	await metadata.discover(readdirSync(result.report.album), ['invented.png']);
	assert.deepEqual(metadata.languages('invented.png').sort(), ['MRG', 'OCR']);

	assert.equal(hash(resolve(result.report.album, 'invented.OCR.bbl')), hash(ocr));
	// Input tampering is rejected before creating a new replay output.
	writeFileSync(ocr, readFileSync(ocr, 'utf8') + ' ');
	await assert.rejects(runSource(manifest, records, dir), /hash mismatch/);
	await assert.rejects(main(['live']), /Offline only/);
});

test('source replay all-skipped pages export empty overlays and invalid accounting exports none', async () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'source-numeric-'));
	const image = resolve(dir, 'numeric.svg'),
		ocr = resolve(dir, 'numeric.OCR.bbl');
	writeFileSync(
		image,
		'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="20" y="45">123</text></svg>'
	);
	save(ocr, { pages: [{ bubbles: [{ text: '123', shape: box(20, 20) }] }] });
	const prepared = prepareSource(image, ocr, 'en', dir, { width: 200, height: 100 });
	const manifest = resolve(prepared, 'manifest.json'),
		recordings = resolve(dir, 'recordings.json');
	save(recordings, {
		'page:source': {
			finishReason: 'stop',
			value: { sourceLanguage: 'en', passages: [{ tokens: ['w0000'] }], exclusions: [] }
		}
	});
	const result = await runSource(manifest, recordings, dir);
	assert.equal(result.report.status, 'complete', result.report.error);
	assert.deepEqual(json(resolve(result.report.album, 'numeric.MRG.bbl')).pages[0].bubbles, []);
	const invalid = resolve(dir, 'invalid.json');
	save(invalid, {
		'page:source': {
			finishReason: 'stop',
			value: { sourceLanguage: 'en', passages: [], exclusions: [] }
		}
	});
	const rejected = await runSource(manifest, invalid, dir);
	assert.equal(rejected.report.status, 'failed');
	assert.match(rejected.report.error, /Missing OCR IDs/);
	assert.equal(existsSync(resolve(rejected.out, 'album')), false);
});
