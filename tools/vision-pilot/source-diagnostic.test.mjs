import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectMembership, diagnosticHtml } from './source-diagnostic.mjs';
import { prepareSource, runSource } from './source-run.mjs';
import { createDiagnostic } from './source-diagnostic.mjs';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('diagnostic retains conflicting, repeated, missing and unknown IDs without repairing raw output', () => {
	const request = {
		document: {
			imageSize: { width: 200, height: 100 },
			words: [
				[
					'a',
					'First',
					'box',
					[
						[10, 10],
						[40, 30]
					]
				],
				[
					'b',
					'Second',
					'box',
					[
						[50, 10],
						[90, 30]
					]
				],
				[
					'c',
					'Omitted',
					'box',
					[
						[100, 10],
						[140, 30]
					]
				]
			]
		}
	};
	const response = {
		value: {
			passages: [
				{
					tokens: [
						'b',
						{ id: 'a', text: '</script> corrected' },
						'a',
						'unknown',
						{
							text: 'added',
							region: {
								type: 'box',
								vs: [
									{ x: 1, y: 40 },
									{ x: 30, y: 60 }
								]
							}
						}
					]
				}
			],
			exclusions: [{ id: 'a', reason: 'false detection' }]
		}
	};
	const baseline = JSON.stringify({ request, response });
	const model = inspectMembership(request, response);
	assert.deepEqual(model.coverage.conflicts, ['a']);
	assert.deepEqual(model.coverage.duplicates, ['a']);
	assert.deepEqual(model.coverage.missing, ['c']);
	assert.equal(model.coverage.unknown[0].id, 'unknown');
	assert.equal(model.coverage.exactlyOnce, false);
	assert.equal(model.words[0].occurrences.length, 3);
	assert.deepEqual(
		model.passages[0].tokens.map((t) => t.id),
		['b', 'a', 'a', 'unknown', null]
	);
	const html = diagnosticHtml(model, 'data:image/jpeg;base64,', { savedError: 'duplicate a' });
	assert.match(html, /USED AND EXCLUDED/);
	assert.match(html, /EXCLUDED 1: false detection/);
	assert.match(html, /1\.2/);
	assert.match(html, /10,10 40,10 40,30 10,30/);
	assert.ok(!html.includes('</script> corrected'));
	assert.equal(JSON.stringify({ request, response }), baseline);
});

test('prepare, reject, inspect and detect tampering while preserving evidence', async () => {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
	const parent = mkdtempSync(resolve(tmpdir(), 'source-diagnostic-output-'));
	const fixture = mkdtempSync(resolve(tmpdir(), 'source-diagnostic-fixture-'));
	try {
		const image = resolve(fixture, 'page.svg'),
			ocr = resolve(fixture, 'page.OCR.bbl');
		writeFileSync(image, '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>');
		writeFileSync(
			ocr,
			JSON.stringify({
				pages: [
					{
						bubbles: [
							{
								text: 'hello',
								shape: {
									type: 'box',
									vs: [
										{ x: 1, y: 1 },
										{ x: 8, y: 5 }
									]
								}
							}
						]
					}
				]
			})
		);
		const prepared = prepareSource(image, ocr, 'en', parent, { width: 20, height: 10 });
		const recordings = resolve(fixture, 'recordings.json');
		writeFileSync(
			recordings,
			JSON.stringify({
				'page:source': {
					finishReason: 'stop',
					value: { sourceLanguage: 'en', passages: [], exclusions: [] }
				}
			})
		);
		const replay = await runSource(resolve(prepared, 'manifest.json'), recordings, parent);
		assert.equal(replay.report.status, 'failed');
		assert.match(replay.report.error, /Missing OCR IDs/);
		const originals = [
			resolve(prepared, 'manifest.json'),
			resolve(prepared, 'source-request.json'),
			resolve(prepared, 'freeze.json'),
			resolve(replay.out, 'source-response.json')
		].map((p) => readFileSync(p));
		const out = createDiagnostic(resolve(prepared, 'manifest.json'), null, replay.out, parent);
		const html = readFileSync(resolve(out, 'comparison.html'), 'utf8');
		assert.match(html, /data:image\/svg\+xml;base64/);
		assert.match(html, /viewBox="0 0 20 10"/);
		assert.match(html, /Saved result status: failed/);
		assert.doesNotMatch(html, /Original JPEG/);
		const cli = spawnSync(
			process.execPath,
			[
				fileURLToPath(new URL('./source-diagnostic.mjs', import.meta.url)),
				resolve(prepared, 'manifest.json'),
				replay.out,
				parent
			],
			{ encoding: 'utf8' }
		);
		assert.equal(cli.status, 0, cli.stderr);
		assert.ok(readFileSync(resolve(cli.stdout.trim(), 'diagnostic.json')));
		assert.deepEqual(
			[
				resolve(prepared, 'manifest.json'),
				resolve(prepared, 'source-request.json'),
				resolve(prepared, 'freeze.json'),
				resolve(replay.out, 'source-response.json')
			].map((p) => readFileSync(p)),
			originals
		);
		assert.throws(
			() => createDiagnostic(resolve(prepared, 'manifest.json'), null, replay.out, replay.out),
			/separate diagnostic directory/
		);
		const legacy = resolve(fixture, 'legacy');
		mkdirSync(legacy);
		for (const name of ['manifest.json', 'source-request.json'])
			writeFileSync(resolve(legacy, name), readFileSync(resolve(prepared, name)));
		const legacyReplay = await runSource(resolve(legacy, 'manifest.json'), recordings, parent);
		assert.equal(legacyReplay.report.status, 'failed');
		assert.match(legacyReplay.report.error, /Missing OCR IDs/);
		assert.doesNotThrow(() =>
			createDiagnostic(resolve(legacy, 'manifest.json'), null, replay.out, parent)
		);
		assert.throws(
			() =>
				createDiagnostic(
					resolve(prepared, 'manifest.json'),
					resolve(fixture, 'absent-freeze.json'),
					replay.out,
					parent
				),
			/Freeze file not found/
		);
		writeFileSync(resolve(prepared, 'source-request.json'), '{}');
		await assert.rejects(
			runSource(resolve(prepared, 'manifest.json'), recordings, parent),
			/Frozen evidence hash mismatch/
		);
	} finally {
		rmSync(parent, { recursive: true, force: true });
		rmSync(fixture, { recursive: true, force: true });
	}
});
