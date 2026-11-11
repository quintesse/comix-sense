import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scorePage20, scorePage20Files } from './source-page20-regression.mjs';

const range = (a, b) =>
	Array.from({ length: b - a + 1 }, (_, i) => `w${String(a + i).padStart(4, '0')}`);
const passage = (tokens) => ({ tokens });
// Synthetic ID-only page: no private text, geometry, artwork or raw response.
function corrected() {
	const rows = [
		range(4, 10),
		range(11, 17),
		range(49, 57),
		[...range(18, 25), ...range(37, 43)],
		[...range(26, 30), ...range(44, 48)],
		range(31, 36),
		range(58, 59),
		range(60, 74),
		range(75, 80),
		[...range(81, 85), ...range(91, 93)],
		[...range(86, 90), ...range(94, 109)],
		range(134, 141),
		[...range(110, 116), ...range(122, 124)],
		['w0130'],
		range(117, 121),
		range(125, 129),
		range(142, 156)
	];
	return {
		request: {
			document: {
				imageSize: { width: 1, height: 1 },
				words: range(0, 157).map((id) => [
					id,
					'synthetic',
					'box',
					[
						[0, 0],
						[1, 1]
					]
				])
			}
		},
		response: {
			value: {
				passages: rows.map(passage),
				exclusions: [...range(0, 3), ...range(131, 133), 'w0157'].map((id) => ({
					id,
					reason: 'synthetic'
				}))
			}
		}
	};
}

test('corrected grouping passes regardless of shifted passage numbers and correction text', () => {
	const { request, response } = corrected();
	response.value.passages.unshift({ tokens: [{ text: 'synthetic added region' }] });
	response.value.passages[4].tokens[0] = { id: 'w0018', text: 'synthetic correction' };
	const before = JSON.stringify({ request, response });
	const score = scorePage20(request, response);
	assert.equal(score.passed, true);
	assert.deepEqual(score.checks, {
		grenade: true,
		wiskeAndJerom: true,
		soldiers: true,
		bottomPanelOrder: true
	});
	assert.equal(score.coverage.accounted, 158);
	assert.equal(score.uniqueness.occurrences, 158);
	assert.equal(JSON.stringify({ request, response }), before);
});

test('first-response defects independently reproduce both merges, late explosion and duplicate exclusion', () => {
	const { request, response } = corrected();
	response.value.passages.splice(4, 2, passage([...range(26, 36), ...range(44, 48)]));
	response.value.passages.splice(
		8,
		2,
		passage([...range(81, 85), ...range(91, 93), ...range(86, 90), ...range(94, 109)])
	);
	const [explosion] = response.value.passages.splice(11, 1);
	response.value.passages.splice(13, 0, explosion);
	response.value.exclusions.push({ id: 'w0031', reason: 'synthetic duplicate' });
	const score = scorePage20(request, response);
	assert.deepEqual(score.checks, {
		grenade: true,
		wiskeAndJerom: false,
		soldiers: false,
		bottomPanelOrder: false
	});
	assert.equal(score.coverage.passed, true);
	assert.equal(score.coverage.accounted, 158);
	assert.equal(score.uniqueness.passed, false);
	assert.deepEqual(score.uniqueness.duplicates, ['w0031']);
	assert.deepEqual(score.uniqueness.conflicts, ['w0031']);
	assert.equal(score.uniqueness.occurrences, 159);
});

test('splitting or reversing grenade rows fails even with perfect coverage and uniqueness', () => {
	for (const reverse of [true, false]) {
		const { request, response } = corrected();
		if (reverse) response.value.passages[3].tokens.reverse();
		else response.value.passages.splice(3, 1, passage(range(18, 25)), passage(range(37, 43)));
		const score = scorePage20(request, response);
		assert.equal(score.checks.grenade, false);
		assert.equal(score.coverage.passed, true);
		assert.equal(score.uniqueness.passed, true);
	}
});

test('every reviewed balloon rejects missing, excluded, repeated, foreign and reordered IDs', () => {
	for (const index of [4, 5, 9, 10]) {
		for (const change of ['omit', 'exclude', 'repeat', 'foreign', 'reverse', 'added']) {
			const { request, response } = corrected();
			const tokens = response.value.passages[index].tokens;
			if (change === 'omit') tokens.shift();
			if (change === 'exclude')
				response.value.exclusions.push({ id: tokens.shift(), reason: 'synthetic' });
			if (change === 'repeat') tokens.push(tokens[0]);
			if (change === 'foreign') tokens.push('w0004');
			if (change === 'reverse') tokens.reverse();
			if (change === 'added') tokens.push({ text: 'synthetic added token' });
			const score = scorePage20(request, response);
			assert.equal(
				score.checks[index < 9 ? 'wiskeAndJerom' : 'soldiers'],
				false,
				`${index}: ${change}`
			);
		}
	}
});

test('panel order fails when explosion is omitted, excluded, repeated, merged or before dialogue', () => {
	for (const change of ['omit', 'exclude', 'repeat', 'merge', 'before', 'replyFirst']) {
		const { request, response } = corrected();
		const rows = response.value.passages;
		if (change === 'omit' || change === 'exclude') rows.splice(13, 1);
		if (change === 'exclude') response.value.exclusions.push({ id: 'w0130', reason: 'synthetic' });
		if (change === 'repeat') rows[13].tokens.push('w0130');
		if (change === 'merge') rows[12].tokens.push(...rows.splice(13, 1)[0].tokens);
		if (change === 'before') rows.splice(12, 0, rows.splice(13, 1)[0]);
		if (change === 'replyFirst') [rows[14], rows[15]] = [rows[15], rows[14]];
		assert.equal(scorePage20(request, response).checks.bottomPanelOrder, false, change);
	}
});

test('coverage and uniqueness do not hide or veto the independent artwork checks', () => {
	const { request, response } = corrected();
	response.value.exclusions.shift();
	response.value.exclusions.push({ id: 'unknown', reason: 'synthetic' });
	const score = scorePage20(request, response);
	assert.ok(Object.values(score.checks).every(Boolean));
	assert.equal(score.coverage.passed, false);
	assert.deepEqual(score.coverage.missing, ['w0000']);
	assert.equal(score.coverage.unknown[0].id, 'unknown');
	assert.equal(score.uniqueness.passed, true);
	assert.equal(score.passed, false);
	request.document.words = request.document.words.filter(([id]) => id !== 'w0018');
	assert.throws(() => scorePage20(request, response), /review IDs absent/);
});

test('file scorer preserves inputs and CLI rejects other OCR even with matching ordinal IDs', () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'page20-regression-'));
	try {
		const { request, response } = corrected();
		const paths = ['request', 'response'].map((name) => resolve(dir, name + '.json'));
		writeFileSync(paths[0], JSON.stringify(request));
		writeFileSync(paths[1], JSON.stringify(response));
		const before = paths.map((path) => readFileSync(path, 'utf8'));
		const syntheticFingerprint = createHash('sha256')
			.update(JSON.stringify(request.document.words))
			.digest('hex');
		assert.throws(() => scorePage20Files(...paths), /frozen OCR fingerprint mismatch/);
		const score = scorePage20Files(...paths, syntheticFingerprint);
		assert.equal(score.inputsUnchanged, true);
		assert.ok(score.evidence.every((e) => /^[a-f0-9]{64}$/.test(e.sha256)));
		assert.deepEqual(
			paths.map((path) => readFileSync(path, 'utf8')),
			before
		);
		const cli = new URL('./source-page20-regression.mjs', import.meta.url);
		const run = (args) =>
			spawnSync(process.execPath, [fileURLToPath(cli), ...args], {
				encoding: 'utf8'
			});
		const wrongPage = run(paths);
		assert.equal(wrongPage.status, 2);
		assert.match(wrongPage.stderr, /frozen OCR fingerprint mismatch/);
		response.value.exclusions.push({ id: 'w0031', reason: 'synthetic' });
		writeFileSync(paths[1], JSON.stringify(response));
		const failed = run(paths);
		assert.equal(failed.status, 2);
		assert.equal(scorePage20Files(...paths, syntheticFingerprint).uniqueness.passed, false);
		assert.equal(run([]).status, 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
