import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	inspectMergeBubbles,
	analyzeMergeBubbles,
	mergeBubbles
} from '../../src/lib/mergeBubbles.ts';
import { inspect, predict, algorithm } from './current.mjs';
import { compare, identities } from './core.mjs';
import { mergeOcrBubbles } from '../../src/lib/ocr.ts';

const word = (text, l, t, r, b, extra = {}) => ({
	text,
	shape: {
		type: 'box',
		vs: [
			{ x: l, y: t },
			{ x: r, y: b }
		]
	},
	...extra
});
const stage = (analysis, name) =>
	analysis.decisions.filter((e) => e.stage === name && e.phase === 'grouping');

test('analysis is deterministic, immutable, and partitions duplicate/empty sources exactly once', async () => {
	const dataset = JSON.parse(await readFile('tests/fixtures/merge/synthetic.json', 'utf8'));
	const inputs = [
		...dataset.pages.map((p) => p.words),
		[
			word('same', 0, 0, 20, 20),
			word('same', 22, 0, 42, 20),
			word('', 44, 0, 46, 20),
			word('!', 47, 10, 50, 20)
		]
	];
	for (const input of inputs) {
		const before = structuredClone(input),
			analysis = inspectMergeBubbles(input);
		assert.deepEqual(input, before);
		assert.deepEqual(inspectMergeBubbles(input), analysis);
		assert.deepEqual(analysis.groups, analyzeMergeBubbles(input));
		assert.deepEqual(
			analysis.groups.map((g) => g.bubble),
			mergeBubbles(input)
		);
		assert.deepEqual(
			analysis.groups.flatMap((g) => g.sourceIndexes).sort((a, b) => a - b),
			input.map((_, i) => i)
		);
		for (const g of analysis.groups)
			assert.deepEqual(
				g.rows.flatMap((r) => r.sourceIndexes).sort((a, b) => a - b),
				g.sourceIndexes.toSorted((a, b) => a - b)
			);
		for (const [i, event] of analysis.decisions.entries()) {
			assert.equal(event.id, i);
			for (const candidate of event.candidates)
				for (const index of candidate) assert(index >= 0 && index < input.length);
		}
		assert.deepEqual(
			analysis.sources.map((s) => s.text),
			input.map((w) => w.text)
		);
	}
	assert.deepEqual(inspectMergeBubbles([]), { groups: [], sources: [], decisions: [] });
});

test('row alternatives expose strict distance ties and final selection', () => {
	const input = [
		word('Small', 0, 10, 20, 20),
		word('Tall', 30, 0, 50, 30),
		word('Middle', 60, 6, 80, 24)
	];
	const events = stage(inspectMergeBubbles(input), 'row');
	const choices = events.filter((e) => e.candidates[0][0] === 2 && 'distance' in e.measurements);
	assert.equal(choices.length, 2);
	assert.equal(choices[0].decision, 'replace-best-row');
	assert.equal(choices[1].measurements.distance, choices[0].measurements.distance);
	assert(choices[1].reasons.includes('not-closer'));
	assert.deepEqual(
		events.find((e) => e.candidates[0][0] === 2 && e.decision === 'assign-row').candidates,
		[[2], [0]]
	);
});

test('horizontal boundary records exact cutoff and punctuation records its actual witness', () => {
	const a = inspectMergeBubbles([
		word('A', 0, 0, 10, 20),
		word('B', 23, 0, 33, 20),
		word('C', 49.00001, 0, 59, 20),
		word(',', 34, 12, 36, 20)
	]);
	const events = stage(a, 'run');
	assert.equal(events.find((e) => e.candidates.at(-1)[0] === 1).decision, 'append-run');
	assert.equal(events.find((e) => e.candidates.at(-1)[0] === 1).measurements.gap, 13);
	assert.equal(events.find((e) => e.candidates.at(-1)[0] === 2).decision, 'start-run');
	const witness = stage(a, 'row-punctuation').find((e) => e.decision === 'punctuation-witness');
	assert(witness.measurements.verticalTouch);
	assert(witness.measurements.gap <= witness.limits.maximumGap);
});

test('equal continuation costs retain first choice and expose fragment reconnection', () => {
	const a = inspectMergeBubbles([
		word('Above', 0, 0, 100, 20),
		word('Left', 0, 24, 40, 44),
		word('Right', 60, 24, 100, 44)
	]);
	const candidates = stage(a, 'continuation').filter((e) => e.decision === 'eligible-continuation');
	assert.equal(candidates.length, 2);
	assert.equal(candidates[0].measurements.cost, 0.2);
	assert.equal(candidates[1].measurements.cost, 0.2);
	const selected = stage(a, 'continuation-selection');
	assert.equal(selected[0].decision, 'join-mutual');
	assert.equal(selected[1].decision, 'not-mutual');
	assert.deepEqual(selected[1].candidates, [[0], [2], [1], [0]]);
	assert(selected[1].reasons.includes('upper-prefers-other'));
	assert.equal(
		stage(a, 'fragment').find((e) => e.decision === 'join-fragment').measurements.centerDistance,
		0
	);
	assert.equal(a.groups.length, 1);
	const rejected = inspectMergeBubbles([
		word('Above', 0, 0, 60, 20),
		word('Left', 0, 24, 40, 44),
		word('Right', 60, 24, 100, 44)
	]);
	assert(stage(rejected, 'continuation').some((e) => e.reasons.includes('no-horizontal-overlap')));
	const overhang = inspectMergeBubbles([
		word('Above', 0, 0, 100, 20),
		word('Left', 0, 24, 40, 44),
		word('Right', 95, 24, 135, 44)
	]);
	assert(
		stage(overhang, 'fragment').some(
			(e) => e.decision === 'reject-fragment' && e.reasons.includes('lower-right-overhang')
		)
	);
	assert.equal(overhang.groups.length, 2);
});

test('gutter evidence records rejected pairs, competing boundary scores and selected cut', () => {
	const a = inspectMergeBubbles([
		word('TopLeft', 0, 0, 30, 20),
		word('TopRight', 60, 0, 100, 20),
		word('BottomLeft', 0, 24, 44, 44),
		word('BottomRight', 56, 24, 100, 44)
	]);
	assert(stage(a, 'gutter-pair').some((e) => e.reasons.includes('gutter-too-narrow')));
	const boundary = stage(a, 'gutter-boundary').find(
		(e) => e.candidates[0][0] === 2 && e.candidates[1][0] === 3
	);
	assert(boundary);
	assert.equal(boundary.measurements.gap, 12);
	assert.equal(boundary.measurements.score, 12 - 0.08 * 5);
	const cut = stage(a, 'gutter-selection').find((e) => e.decision === 'add-cut');
	assert.deepEqual(cut.candidates.slice(-2), [[2], [3]]);
	assert.equal(cut.measurements.score, boundary.measurements.score);
	assert.deepEqual(
		a.groups.map((g) => g.sourceIndexes),
		[
			[0, 2],
			[1, 3]
		]
	);
	const negative = inspectMergeBubbles([
		word('TopLeft', 0, 0, 30, 20),
		word('TopRight', 60, 0, 100, 20),
		word('BottomLeft', 0, 24, 44, 44),
		word('BottomRight', 44, 24, 100, 44)
	]);
	const negativeCut = stage(negative, 'gutter-selection').find((e) => e.decision === 'add-cut');
	assert.equal(negativeCut.measurements.score, -0.08);
});

test('analysis leaves compatibility, metadata inheritance, formatting, outlines and app filtering intact', () => {
	const input = [
		word(' well-\nknown ', 0, 0, 40, 20, { lang: 'en', font: { family: 'first' } }),
		word('friend', 42, 0, 90, 20, { lang: 'en', font: { family: 'second' } }),
		word('123', 200, 0, 220, 20),
		word('Separate', 0, 24, 100, 44, { lang: 'nl' }),
		word('Placed', 0, 48, 100, 68, {
			layout: {
				vs: [
					{ x: 0, y: 0 },
					{ x: 100, y: 100 }
				]
			}
		})
	];
	const groups = inspectMergeBubbles(input).groups;
	assert.deepEqual(
		groups.map((g) => g.sourceIndexes),
		[[0, 1], [2], [3], [4]]
	);
	assert.equal(groups[0].bubble.text, 'well-known friend');
	assert.deepEqual(groups[0].bubble.shape, {
		type: 'box',
		vs: [
			{ x: 0, y: 0 },
			{ x: 90, y: 20 }
		]
	});
	assert.deepEqual(groups[0].bubble.font, { family: 'first' });
	assert.deepEqual(
		mergeOcrBubbles(input),
		groups.filter((g) => /\p{L}/u.test(g.bubble.text)).map((g) => g.bubble)
	);
});

test('offline IDs and JSON costs are stable, traces do not affect compatible baseline comparisons', () => {
	const words = [word('First', 0, 0, 20, 20), word('Other', 100, 0, 120, 20)].map((w, i) => ({
		...w,
		id: `source-${i}`
	}));
	const input = { id: 'case', words },
		analysis = inspect(input);
	assert.deepEqual(analysis.groups, predict(input));
	const roundTrip = JSON.parse(JSON.stringify(analysis.diagnostics));
	const candidateMap = new Map(roundTrip.candidates.map((c) => [c.id, c.members]));
	assert(roundTrip.decisions.every((e) => e.candidates.every((c) => candidateMap.has(c))));
	assert(roundTrip.decisions.some((e) => e.measurements.cost === 'Infinity'));
	const baseline = {
		schemaVersion: 1,
		metricVersion: 1,
		algorithm,
		pages: [{ id: input.id, input, ...identities(input), groups: predict(input) }]
	};
	const current = structuredClone(baseline);
	current.pages[0].diagnostics = roundTrip;
	assert.equal(compare(current, baseline)[0].behaviorChanged, false);
	current.pages[0].groups[0].bubble.text = 'Changed';
	assert.equal(compare(current, baseline)[0].behaviorChanged, true);
});
