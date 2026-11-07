import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validate, evaluate, identities, compare } from './core.mjs';
import { predict, algorithm } from './current.mjs';
import { mergeBubbles, analyzeMergeBubbles } from '../../src/lib/mergeBubbles.ts';
import { mergeOcrBubbles } from '../../src/lib/ocr.ts';
import { html } from './report.mjs';

const fixture = JSON.parse(await readFile('tests/fixtures/merge/synthetic.json', 'utf8'));
const group = (members, rows = [members]) => ({
	members,
	rows: rows.map((members) => ({ members }))
});
const page = () => structuredClone(fixture.pages[0]);
test('independently calculated false join/split, lines, order and exact counts', () => {
	const input = page();
	// Expected abc/d, predicted abd/c: ad and bd false joins; ac and bc false splits.
	const m = evaluate(input, [group(['a', 'b', 'd']), group(['c'])]);
	assert.equal(m.falseJoins, 2);
	assert.equal(m.falseSplits, 2);
	assert.equal(m.sameBubblePairs, 3);
	assert.equal(m.differentBubblePairs, 3);
	assert.equal(m.exactBubbles, 0);
	assert.equal(m.completeBubbles, 2);
	assert.equal(m.linePairs, 3);
	assert.equal(m.lineErrors, 0);
	assert.equal(m.orderPairs, 2);
	assert.equal(m.orderIncomparable, 1);
	const lines = evaluate(input, [group(['a', 'b', 'c'], [['c', 'b'], ['a']]), group(['d'])]);
	assert.equal(lines.lineErrors, 2);
	assert.equal(lines.orderErrors, 2);
});
test('perfect grouping and arbitrary label renaming', () => {
	const input = page(),
		prediction = [group(['a', 'b', 'c'], [['a', 'b'], ['c']]), group(['d'])];
	const m = evaluate(input, prediction);
	assert.equal(m.falseJoins + m.falseSplits + m.lineErrors + m.orderErrors, 0);
	assert.equal(m.exactBubbles, 2);
	for (const word of input.words) {
		word.review.bubble = `renamed-${word.review.bubble}`;
		word.review.line = `line-${word.review.line}`;
	}
	input.completeBubbles = input.completeBubbles.map((v) => `renamed-${v}`);
	assert.deepEqual(evaluate(input, prediction), m);
	input.words.reverse();
	assert.deepEqual(evaluate(input, prediction), m);
});
test('partial/excluded/ambiguous labels are not negative labels; exactness needs explicit completeness', () => {
	const input = structuredClone(fixture.pages[1]);
	const m = evaluate(input, [group(input.words.map((w) => w.id))]);
	assert.equal(m.reviewed, 3);
	assert.equal(m.unreviewed, 1);
	assert.equal(m.ambiguous, 1);
	assert.equal(m.excluded, 1);
	assert.equal(m.falseJoins, 0);
	assert.equal(m.differentBubblePairs, 0);
	assert.equal(m.exactBubbles, 0);
	assert.equal(m.exactBubbleEligible, 0);
	assert.equal(m.exactBubbleUnscored, 1);
	const incomplete = page();
	delete incomplete.words[0].review.line;
	assert.equal(evaluate(incomplete, [group(['a', 'b', 'c']), group(['d'])]).linePairs, 1);
	delete input.completeBubbles;
	assert.equal(evaluate(input, [group(input.words.map((w) => w.id))]).completeBubbles, 0);
});
test('schema rejects invalid identities, geometry, references and contradictions', () => {
	validate(fixture);
	for (const mutate of [
		(p) => p.words.push(p.words[0]),
		(p) => (p.words[0].shape.vs[0].x = NaN),
		(p) => (p.words[0].shape.vs[1] = p.words[0].shape.vs[0]),
		(p) => (p.order = [['a', 'missing']]),
		(p) =>
			(p.order = [
				['a', 'b'],
				['b', 'a']
			]),
		(p) => (p.completeBubbles = ['missing']),
		(p) => (p.words[0].review.status = 'excluded'),
		(p) => delete p.words[0].review.bubble,
		(p) => (p.words[0].layout = { type: 'poly', vs: p.words[0].shape.vs })
	]) {
		const p = page();
		mutate(p);
		assert.throws(() => validate({ schemaVersion: 1, pages: [p] }));
	}
	assert.throws(() => evaluate(page(), [group(['a', 'a', 'c', 'd'])]));
	assert.throws(() => evaluate(page(), [group(['a', 'b', 'c'])]));
});
test('diagnostics preserve normal output, identity, empty/punctuation and nonmutation', () => {
	assert.deepEqual(analyzeMergeBubbles([]), []);
	assert.deepEqual(mergeBubbles([]), []);
	for (const input of fixture.pages) {
		const snapshot = JSON.stringify(input),
			words = input.words.map(({ id, review, ...w }) => w);
		const normal = mergeBubbles(words),
			diagnostic = analyzeMergeBubbles(words);
		assert.deepEqual(
			diagnostic.map((g) => g.bubble),
			normal
		);
		assert.deepEqual(
			diagnostic.flatMap((g) => g.sourceIndexes).sort((a, b) => a - b),
			words.map((_, i) => i)
		);
		assert.deepEqual(
			diagnostic.flatMap((g) => g.rows.flatMap((r) => r.sourceIndexes)).sort((a, b) => a - b),
			words.map((_, i) => i)
		);
		assert.deepEqual(
			mergeOcrBubbles(words),
			normal.filter((b) => /\p{L}/u.test(b.text))
		);
		assert.equal(JSON.stringify(input), snapshot);
		assert.equal(evaluate(input, predict(input)).falseJoins, 0);
		assert(normal.every((b) => !('sourceIndexes' in b) && !('rows' in b)));
	}
	const singleton = fixture.pages[1].words[3];
	assert.equal(predict({ words: [singleton] })[0].rows[0].members[0], 'empty');
	const extended = page();
	extended.words[0].extended = { confidence: 0.01, providerLine: 'untrusted', break: 'LINE_BREAK' };
	assert.deepEqual(predict(extended), predict(page()));
});
function report(input = page(), groups = predict(input)) {
	return {
		schemaVersion: 1,
		metricVersion: 1,
		algorithm,
		pages: [{ id: input.id, ...identities(input), input, groups, metrics: evaluate(input, groups) }]
	};
}
test('baseline matches by ID, checks inputs and labels, and exposes improvements/regressions', () => {
	const current = report(),
		baseline = report();
	assert.equal(compare(current, baseline)[0].behaviorChanged, false);
	const bad = report(page(), [group(['a', 'b', 'd']), group(['c'])]);
	assert.equal(compare(bad, baseline)[0].changes.falseJoins, 2);
	assert.equal(compare(current, bad)[0].changes.falseSplits, -2);
	assert(compare(bad, baseline)[0].regressions.length > 0);
	assert(compare(current, bad)[0].improvements.length > 0);
	// Equal totals still expose the specific relationships that improved/regressed.
	const alternate = report(page(), [group(['a', 'c', 'd']), group(['b'])]);
	const offset = compare(alternate, bad)[0];
	assert.equal(offset.changes.falseJoins, 0);
	assert(offset.improvements.length > 0 && offset.regressions.length > 0);
	for (const key of ['inputHash', 'labelHash', 'id']) {
		const altered = structuredClone(baseline);
		altered.pages[0][key] = 'changed';
		assert.throws(() => compare(current, altered));
	}
	const changed = page();
	changed.words[0].text = 'changed';
	assert.throws(() => compare(report(changed), baseline));
	const relabeled = page();
	relabeled.words[0].review.line = 'changed';
	assert.throws(() => compare(report(relabeled), baseline));
	assert.throws(() => compare(current, { ...baseline, metricVersion: 2 }));
	const two = { ...current, pages: [...current.pages, { ...current.pages[0], id: 'second' }] };
	assert.equal(compare(two, { ...two, pages: two.pages.toReversed() }).length, 2);
});
test('HTML escapes private dataset strings and works without images', async () => {
	const input = page();
	input.words[0].text = '<script>alert("x")</script>';
	input.id = '</h2><img src=x>';
	const output = await html(report(input), '.');
	assert(!output.includes('<script>'));
	assert(output.includes('&lt;script&gt;'));
	assert(output.includes('<svg'));
	assert(!output.includes('https://'));
});
test('CLI offline end to end, immutable inputs, baseline and failure exit codes', async () => {
	const temporary = await mkdtemp(path.join(tmpdir(), 'merge-eval-'));
	const snapshot = await readFile('tests/fixtures/merge/synthetic.json', 'utf8');
	const cli = (...args) =>
		spawnSync(
			process.execPath,
			['--import', './tools/merge-eval/register.mjs', 'tools/merge-eval/cli.mjs', ...args],
			{ encoding: 'utf8' }
		);
	const base = ['--dataset', 'tests/fixtures/merge/synthetic.json'];
	try {
		const first = cli(...base, '--output', path.join(temporary, 'first'));
		assert.equal(first.status, 0, first.stderr);
		const second = cli(
			...base,
			'--output',
			path.join(temporary, 'second'),
			'--baseline',
			path.join(temporary, 'first/report.json')
		);
		assert.equal(second.status, 0, second.stderr);
		assert.equal(
			cli(...base, '--output', path.join(temporary, 'third'), '--baseline', 'package.json').status,
			3
		);
		assert.equal(cli(...base, '--output', 'tests/private-report').status, 2);
		assert.equal(cli(...base).status, 2);
		assert.equal(cli(...base, '--output', path.join(temporary, 'first')).status, 2);
		const input = page();
		input.words[1].review.bubble = 'separate';
		delete input.order;
		delete input.completeBubbles;
		await writeFile(
			path.join(temporary, 'cases.json'),
			JSON.stringify({ schemaVersion: 1, pages: [input] })
		);
		await writeFile(
			path.join(temporary, 'baseline.json'),
			JSON.stringify(report(input, [group(['a', 'c']), group(['b']), group(['d'])]))
		);
		assert.equal(
			cli(
				'--dataset',
				path.join(temporary, 'cases.json'),
				'--output',
				path.join(temporary, 'regressed'),
				'--baseline',
				path.join(temporary, 'baseline.json')
			).status,
			4
		);
		assert.equal(await readFile('tests/fixtures/merge/synthetic.json', 'utf8'), snapshot);
	} finally {
		assert.equal(path.dirname(temporary), tmpdir());
		await rm(temporary, { recursive: true, force: true });
	}
});
