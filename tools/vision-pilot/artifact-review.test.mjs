import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { artifactReview } from './artifact-review.mjs';

const svg = (fill, text) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${fill}"/><text x="8" y="45">${text}</text></svg>`;

test('saved-artifact review preserves inputs, escapes labels and protects prior output', async () => {
	const root = mkdtempSync(resolve(tmpdir(), 'artifact-review-'));
	const input = resolve(root, 'input');
	const output = resolve(root, 'output');
	mkdirSync(input);
	mkdirSync(output);
	writeFileSync(resolve(input, 'original.svg'), svg('white', 'original'));
	writeFileSync(resolve(input, 'candidate.svg'), svg('#def', 'candidate'));
	const manifestFile = resolve(input, 'manifest.json');
	writeFileSync(
		manifestFile,
		JSON.stringify({
			schemaVersion: 1,
			title: 'Saved <review> & comparison',
			pages: [
				{
					id: 'page-1',
					label: 'Synthetic page',
					width: 120,
					height: 80,
					note: 'Invented page',
					variants: [
						{ id: 'original', label: 'Original <art>', image: 'original.svg' },
						{ id: 'candidate', label: 'Saved candidate', image: 'candidate.svg' }
					],
					passages: [
						{
							id: 'p1',
							label: 'Crop & note',
							view: [10, 5, 60, 40],
							note: 'Manual <crop>',
							provenance: 'synthetic-manual'
						}
					]
				}
			]
		})
	);
	const inputs = ['manifest.json', 'original.svg', 'candidate.svg'].map((name) =>
		readFileSync(resolve(input, name))
	);
	const first = artifactReview(manifestFile, output);
	const second = artifactReview(manifestFile, output);
	assert.notEqual(first.output, second.output);
	assert.deepEqual(
		['manifest.json', 'original.svg', 'candidate.svg'].map((name) =>
			readFileSync(resolve(input, name))
		),
		inputs
	);
	const html = readFileSync(first.review, 'utf8');
	assert.match(html, /Saved &lt;review&gt; &amp; comparison/);
	assert.doesNotMatch(html, /<review>/);
	const browser = await chromium.launch({
		channel: process.platform === 'win32' ? 'msedge' : undefined
	});
	try {
		const page = await browser.newPage({ viewport: { width: 500, height: 500 } });
		const external = [];
		page.on('request', (request) => {
			if (/^https?:/.test(request.url())) external.push(request.url());
		});
		await page.goto(pathToFileURL(first.review).href);
		await page.getByLabel('Passage or crop').selectOption('0');
		assert.equal(await page.locator('svg').first().getAttribute('viewBox'), '10 5 60 40');
		assert.match(await page.locator('#context').textContent(), /Manual <crop>/);
		const responsiveWidth = await page
			.locator('svg')
			.first()
			.evaluate((el) => el.getBoundingClientRect().width);
		await page.getByLabel('Original pixel size').check();
		assert.equal(
			await page
				.locator('svg')
				.first()
				.evaluate((el) => el.getBoundingClientRect().width),
			60
		);
		await page.getByLabel('Original pixel size').uncheck();
		assert.equal(
			await page
				.locator('svg')
				.first()
				.evaluate((el) => el.getBoundingClientRect().width),
			responsiveWidth
		);
		assert.deepEqual(external, []);
	} finally {
		await browser.close();
	}
});

test('saved-artifact review rejects crops outside the declared page', () => {
	const root = mkdtempSync(resolve(tmpdir(), 'artifact-review-invalid-'));
	for (const name of ['a.svg', 'b.svg']) writeFileSync(resolve(root, name), svg('white', name));
	const manifest = resolve(root, 'manifest.json');
	writeFileSync(
		manifest,
		JSON.stringify({
			schemaVersion: 1,
			title: 'Invalid crop',
			pages: [
				{
					id: 'p',
					width: 120,
					height: 80,
					variants: [
						{ id: 'a', label: 'A', image: 'a.svg' },
						{ id: 'b', label: 'B', image: 'b.svg' }
					],
					passages: [{ id: 'bad', view: [100, 10, 30, 20] }]
				}
			]
		})
	);
	assert.throws(() => artifactReview(manifest, root), /outside page/);
});
