import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { comparisonHtml, rectangleUnion, refreshComparison } from './comparison.mjs';
import { fittingCandidates, fittingSpace } from './lettering.mjs';

const box = (x, y, r, b) => ({
	type: 'box',
	vs: [
		{ x, y },
		{ x: r, y: b }
	]
});
const bubble = { shape: box(20, 20, 100, 80), layout: box(24, 24, 96, 70), lang: 'nl' };
const interiors = [{ left: 18, right: 110, top: 18, bottom: 90, inset: true }];
const image =
	'data:image/svg+xml;base64,' +
	Buffer.from(
		'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="white"/></svg>'
	).toString('base64');
const spaces = fittingSpace([fittingCandidates({ shape: bubble.shape }, interiors)], [bubble]);

test('candidate ledger records exact interior and OCR candidates with fitting padding', () => {
	assert.equal(spaces[0].candidates.length, 2);
	assert.deepEqual(spaces[0].candidates[0].usable, { left: 18, right: 110, top: 18, bottom: 90 });
	assert.deepEqual(spaces[0].candidates[1].usable, { left: 22, right: 98, top: 23, bottom: 77 });
	assert.deepEqual(spaces[0].selected, bubble.layout);
	const union = rectangleUnion([
		{ left: 0, right: 20, top: 0, bottom: 20 },
		{ left: 10, right: 30, top: 0, bottom: 20 }
	]);
	assert.equal(union.fill, 'M0,0H30V20H0Z');
	assert.ok(
		!union.outline.includes('M10,'),
		'Overlaps must not introduce invented interior boundaries'
	);
});

test('space and selected-layout toggles remain aligned and independent from original-size zoom', async () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'pilot-comparison-'));
	const file = resolve(dir, 'comparison.html');
	writeFileSync(
		file,
		comparisonHtml({
			image,
			renderedImage: image,
			imageSize: { width: 400, height: 200 },
			source: 'nl',
			target: 'en',
			spaces
		})
	);
	const browser = await chromium.launch({
		channel: process.platform === 'win32' ? 'msedge' : undefined
	});
	try {
		const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
		const external = [];
		page.on('request', (r) => {
			if (/^https?:/.test(r.url())) external.push(r.url());
		});
		await page.goto(pathToFileURL(file).href);
		assert.equal(await page.getByLabel('Show available fitting space').isChecked(), false);
		assert.equal(await page.locator('.fit-space').first().isVisible(), false);
		const align = async () =>
			assert.ok(
				await page.locator('.page').evaluateAll((pages) =>
					pages.every((p) => {
						const i = p.querySelector('img').getBoundingClientRect(),
							s = p.querySelector('svg').getBoundingClientRect();
						return (
							Math.abs(i.x - s.x) < 0.1 &&
							Math.abs(i.y - s.y) < 0.1 &&
							Math.abs(i.width - s.width) < 0.1 &&
							Math.abs(i.height - s.height) < 0.1
						);
					})
				)
			);
		await align();
		const initialWidth = await page
			.locator('main')
			.evaluate((e) => e.getBoundingClientRect().width);
		await page.getByLabel('Show available fitting space').check();
		assert.equal(await page.locator('.fit-space').first().isVisible(), true);
		assert.equal(await page.getByLabel('Original size', { exact: true }).isChecked(), false);
		assert.equal(
			await page.locator('main').evaluate((e) => e.getBoundingClientRect().width),
			initialWidth
		);
		assert.equal(await page.locator('.selected-layout').first().isVisible(), false);
		await page.getByLabel('Show selected text layouts').check();
		await page.getByLabel('Original size', { exact: true }).check();
		assert.equal(await page.locator('main').evaluate((e) => e.getBoundingClientRect().width), 804);
		await align();
		assert.ok(
			await page.locator('.page').evaluateAll((pages) =>
				pages.every((p) => {
					const i = p.querySelector('img').getBoundingClientRect(),
						r = p.querySelector('.selected-layout').getBoundingClientRect(),
						scale = i.width / 400;
					return (
						Math.abs(r.x - i.x - 24 * scale) < 0.1 &&
						Math.abs(r.y - i.y - 24 * scale) < 0.1 &&
						Math.abs(r.width - 72 * scale) < 0.1
					);
				})
			)
		);
		await page.getByLabel('Show available fitting space').uncheck();
		assert.equal(await page.getByLabel('Original size', { exact: true }).isChecked(), true);
		assert.equal(await page.locator('.selected-layout').first().isVisible(), true);
		await page.getByLabel('Original size', { exact: true }).uncheck();
		await page.setViewportSize({ width: 900, height: 600 });
		await align();
		await page.evaluate(() => (document.body.style.zoom = '1.25'));
		await align();
		assert.deepEqual(external, []);
	} finally {
		await browser.close();
	}
});

test('presentation refresh uses saved masks/candidates and leaves evidence and rendered pixels intact', () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'pilot-refresh-'));
	const props = { image, imageSize: { width: 400, height: 200 }, bubbles: [bubble] };
	writeFileSync(
		resolve(dir, 'source.html'),
		`<script>window.pilot=${JSON.stringify(props)}</script>`
	);
	writeFileSync(resolve(dir, 'source.review.png'), 'unchanged saved pixels');
	writeFileSync(resolve(dir, 'source.fitter-space.json'), JSON.stringify(spaces));
	const paths = ['source.html', 'source.review.png', 'source.fitter-space.json'].map((p) =>
		resolve(dir, p)
	);
	const before = paths.map((p) => readFileSync(p, 'utf8'));
	refreshComparison(dir);
	assert.deepEqual(JSON.parse(readFileSync(resolve(dir, 'source.fitter-space.json'))), spaces);
	assert.deepEqual(
		paths.map((p) => readFileSync(p, 'utf8')),
		before
	);
	assert.match(
		readFileSync(resolve(dir, 'comparison.html'), 'utf8'),
		/id="available-space"[^>]*checked/
	);
	assert.match(
		readFileSync(resolve(dir, 'comparison.html'), 'utf8'),
		/id="selected-layout"[^>]*checked/
	);
	refreshComparison(dir, 'source', false);
	assert.ok(
		!/id="available-space"[^>]*checked/.test(readFileSync(resolve(dir, 'comparison.html'), 'utf8'))
	);
});
