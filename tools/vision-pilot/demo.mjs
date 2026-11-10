import { resolve, dirname } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { save, baseline, wordsFromBbl } from './core.mjs';
import { run } from './run.mjs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

export async function demo(parent) {
	const fixture = mkdtempSync(resolve(parent, 'synthetic-'));
	const shape = (x, y, w, h) => ({
		type: 'box',
		vs: [
			{ x, y },
			{ x: x + w, y: y + h }
		]
	});
	const raw = {
		lang: 'en',
		pages: [
			{
				bubbles: [
					{ text: 'Hello', lang: 'en', shape: shape(80, 80, 130, 50) },
					{ text: 'friend!', lang: 'en', shape: shape(220, 80, 145, 50) },
					{ text: 'art-noise', lang: 'en', shape: shape(400, 300, 60, 30) }
				]
			}
		]
	};
	const { writeFileSync } = await import('node:fs');
	writeFileSync(
		resolve(fixture, 'invented.svg'),
		'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="#b7deed"/><rect x="15" y="15" width="570" height="420" fill="none" stroke="black" stroke-width="4"/><ellipse cx="220" cy="110" rx="190" ry="80" fill="white" stroke="black" stroke-width="3"/><text x="80" y="117" font-family="sans-serif" font-size="35">Hello</text><text x="220" y="117" font-family="sans-serif" font-size="35">friend!</text><circle cx="250" cy="295" r="55" fill="#fa9" stroke="black"/><path d="M210 290h15m35 0h15m-40 27q15 15 30 0M250 350v65M420 300l40 30m-40 0l40-30" fill="none" stroke="black" stroke-width="4"/></svg>',
		{ flag: 'wx' }
	);
	const browser = await chromium.launch({
		channel: process.platform === 'win32' ? 'msedge' : undefined
	});
	try {
		const tab = await browser.newPage({ viewport: { width: 600, height: 450 } });
		await tab.goto(pathToFileURL(resolve(fixture, 'invented.svg')).href);
		await tab.screenshot({ path: resolve(fixture, 'invented.png') });
	} finally {
		await browser.close();
	}
	save(resolve(fixture, 'invented.OCR.bbl'), raw);
	const maximum = { textInput: 20000, imageInput: 10000, output: 16000, ocr: 0 };
	const page = {
		id: 'invented',
		image: 'invented.png',
		ocr: 'invented.OCR.bbl',
		imageSize: { width: 600, height: 450 },
		ocrMode: 'reused',
		maximum: { baseline: { ...maximum, imageInput: 0 }, vision: maximum }
	};
	const manifest = {
		schemaVersion: 1,
		sourceLanguage: 'en',
		targetLanguage: 'es',
		glossary: {},
		maskStyle: { opacity: '1' },
		capEuro: 0.1,
		rates: {
			textInput: 0.1,
			imageInput: 0.1,
			output: 0.4,
			ocr: 0.0015,
			eurPerUsd: 1.1,
			taxMultiplier: 1.21,
			kind: 'planning-upper-bound',
			date: '2026-11-07'
		},
		pages: [page]
	};
	const prepared = await baseline(
		{
			...page,
			sourceLanguage: 'en',
			targetLanguage: 'es',
			words: wordsFromBbl(raw, page.imageSize)
		},
		0
	);
	const usage = { textInput: 1000, imageInput: 500, output: 300, ocr: 0 };
	const vision = {
		sourceLanguage: 'en',
		targetLanguage: 'es',
		passages: [
			{
				id: 'p1',
				wordIds: ['w0000', 'w0001'],
				source: 'Hello friend!',
				translation: '¡Hola, amigo!',
				tokens: [
					{ kind: 'ocr', ids: ['w0000'], text: 'Hello', region: null },
					{ kind: 'ocr', ids: ['w0001'], text: 'friend!', region: null }
				]
			}
		],
		readingOrder: ['p1'],
		exclusions: [{ id: 'w0002', reason: 'Invented crossed strokes are artwork, not lettering.' }]
	};
	const records = {
		'invented:baseline': {
			finishReason: 'stop',
			usage: { ...usage, imageInput: 0 },
			value: {
				...prepared.document,
				items: prepared.document.items.map((v, i) => ({
					...v,
					text: i === 0 ? '¡Hola, amigo!' : 'ruido de arte'
				}))
			}
		},
		'invented:vision': { finishReason: 'stop', usage, value: vision }
	};
	save(resolve(fixture, 'manifest.json'), manifest);
	save(resolve(fixture, 'recordings.json'), records);
	const success = await run(
		resolve(fixture, 'manifest.json'),
		resolve(fixture, 'recordings.json'),
		parent
	);
	assert.equal(success.report.status, 'complete');
	assert.equal(success.report.inputsUnchanged, true);
	assert.equal(success.report.pages[0].methods.vision.parsedBubbles, 1);
	const bad = structuredClone(records);
	bad['invented:vision'].value.passages[0].wordIds.pop();
	bad['invented:vision'].value.passages[0].tokens.pop();
	bad['invented:vision'].value.passages[0].source = 'Hello';
	save(resolve(fixture, 'missing-id.json'), bad);
	const rejected = await run(
		resolve(fixture, 'manifest.json'),
		resolve(fixture, 'missing-id.json'),
		parent
	);
	assert.match(rejected.report.pages[0].methods.vision.error, /Missing OCR IDs/);
	const refusedManifest = { ...manifest, capEuro: 0.000001 };
	save(resolve(fixture, 'budget.json'), refusedManifest);
	const refused = await run(
		resolve(fixture, 'budget.json'),
		resolve(fixture, 'recordings.json'),
		parent
	);
	assert.equal(refused.report.dispatched, 0);
	assert.equal(refused.report.failures.length, 2);
	const summary = {
		fixture,
		success: success.out,
		rejected: rejected.out,
		budgetRefusal: refused.out,
		checks: [
			'both workflows rendered',
			'ordinary BBL parsed by production parser',
			'missing ID rejected without overlay',
			'budget refused before dispatch',
			'input hashes unchanged'
		],
		actualSpendEuro: 0
	};
	save(resolve(fixture, 'rehearsal.json'), summary);
	return summary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length !== 3)
		throw new Error(
			'Usage: node --import ./tools/merge-eval/register.mjs tools/vision-pilot/demo.mjs EXISTING_PRIVATE_DIRECTORY'
		);
	console.log(JSON.stringify(await demo(resolve(process.argv[2])), null, 2));
}
