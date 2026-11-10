import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOcrBubbles, canAnalyzeOcrPixels } from '../../src/lib/ocr.ts';
import { analyzeMergeBubbles } from '../../src/lib/mergeBubbles.ts';

function page(width = 360, height = 240) {
	const data = new Uint8ClampedArray(width * height * 4).fill(255);
	const paint = (l, t, r, b, value = 0) => {
		for (let y = t; y < b; y++)
			for (let x = l; x < r; x++) {
				const at = (y * width + x) * 4;
				data[at] = data[at + 1] = data[at + 2] = value;
			}
	};
	const frame = (l, t, r, b) => {
		paint(l, t, r, t + 3);
		paint(l, b - 3, r, b);
		paint(l, t, l + 3, b);
		paint(r - 3, t, r, b);
	};
	return { pixels: { width, height, data }, paint, frame };
}
const word = (text, x, y, w = 40, h = 20, extra = {}) => ({
	text,
	lang: 'en',
	shape: {
		type: 'box',
		vs: [
			{ x, y },
			{ x: x + w, y: y + h }
		]
	},
	...extra
});
const texts = (groups) => groups.map((g) => g.text.replace(/\s+/g, ' '));

test('stable neighboring enclosures separate words in a geometrically merged row', () => {
	const f = page();
	f.frame(10, 10, 95, 85);
	f.frame(95, 10, 180, 85);
	const words = [word('Left', 50, 25), word('Right', 100, 25)];
	const copy = structuredClone(words),
		pixels = f.pixels.data.slice();
	assert.equal(mergeOcrBubbles(words).length, 1);
	assert.deepEqual(texts(mergeOcrBubbles(words, f.pixels)), ['Left', 'Right']);
	assert.deepEqual(words, copy);
	assert.deepEqual(f.pixels.data, pixels);
});

test('a stable shared enclosure reunites nearby geometric fragments and retains metadata', () => {
	const f = page();
	f.frame(10, 10, 180, 65);
	const words = [
		word('Hello', 30, 25, 40, 20, { font: { size: 18 }, style: { opacity: '0.6' } }),
		word('friend', 90, 25, 40, 20, { font: { size: 18 }, style: { opacity: '0.6' } })
	];
	assert.equal(mergeOcrBubbles(words).length, 2);
	const result = mergeOcrBubbles(words, f.pixels);
	assert.deepEqual(texts(result), ['Hello friend']);
	assert.deepEqual(result[0].font, { size: 18 });
	assert.deepEqual(result[0].style, { opacity: '0.6' });
	assert.equal(result[0].lang, 'en');
});

test('open borders, backgrounds and unknown crossing words keep complete baseline groups', () => {
	for (const kind of ['blank', 'open', 'crossing']) {
		const f = page();
		if (kind !== 'blank') {
			f.frame(10, 10, 95, 85);
			f.frame(95, 10, 180, 85);
		}
		if (kind === 'open') f.paint(10, 10, 180, 15, 255);
		const words =
			kind === 'crossing'
				? [word('Left', 50, 25), word('crossing', 85, 25, 30), word('Right', 120, 25)]
				: [word('Left', 50, 25), word('Right', 100, 25)];
		assert.deepEqual(mergeOcrBubbles(words, f.pixels), mergeOcrBubbles(words), kind);
	}
});

test('different source metadata or explicit layouts prevent pixel joins', () => {
	const f = page();
	f.frame(10, 10, 180, 65);
	const variants = [
		{ lang: 'fr' },
		{ style: { opacity: '0.4' } },
		{ font: { size: 19 } },
		{
			layout: {
				type: 'box',
				vs: [
					{ x: 90, y: 25 },
					{ x: 130, y: 45 }
				]
			}
		}
	];
	for (const extra of variants) {
		const words = [word('Hello', 30, 25), word('friend', 90, 25, 40, 20, extra)];
		assert.deepEqual(mergeOcrBubbles(words, f.pixels), mergeOcrBubbles(words));
	}
});

test('disabled and unsupported pixels preserve geometric output and dimension guard bounds allocation', () => {
	const words = [word('Hello', 30, 25), word('123', 75, 25, 30), word('Sound', 220, 150)];
	const expected = analyzeMergeBubbles(words)
		.map((g) => g.bubble)
		.filter((b) => /\p{L}/u.test(b.text));
	assert.deepEqual(mergeOcrBubbles(words), expected);
	assert.deepEqual(mergeOcrBubbles(words, undefined), expected);
	assert.deepEqual(mergeOcrBubbles(words, { width: 200, height: 100, data: [] }), expected);
	assert.deepEqual(mergeOcrBubbles(words, { width: 5000, height: 5000, data: [] }), expected);
	assert.equal(canAnalyzeOcrPixels(4000, 4000), true);
	assert.equal(canAnalyzeOcrPixels(4001, 4000), false);
	for (const [w, h] of [
		[0, 20],
		[20, 0],
		[1.5, 20],
		[Infinity, 1],
		[-1, 20]
	])
		assert.equal(canAnalyzeOcrPixels(w, h), false);
});

test('bounded pooling keeps original coordinates and removes synthetic lettering only in analysis', () => {
	const factor = 4,
		f = page(360 * factor, 240 * factor);
	f.frame(10 * factor, 10 * factor, 95 * factor, 85 * factor);
	f.frame(95 * factor, 10 * factor, 180 * factor, 85 * factor);
	const words = [
		word('Left', 50 * factor, 25 * factor, 40 * factor, 20 * factor),
		word('Right', 100 * factor, 25 * factor, 40 * factor, 20 * factor)
	];
	for (const w of words) {
		const p = w.shape.vs[0];
		for (let i = 0; i < 4; i++) f.paint(p.x + 8 + i * 28, p.y + 10, p.x + 13 + i * 28, p.y + 65);
	}
	const result = mergeOcrBubbles(words, f.pixels);
	assert.deepEqual(texts(result), ['Left', 'Right']);
	assert.deepEqual(result[0].shape, words[0].shape);
	assert.deepEqual(result[1].shape, words[1].shape);
});

test('transparent pixels and pathological component counts conservatively retain baseline', () => {
	const words = [word('Hello', 30, 25), word('friend', 90, 25)];
	const transparent = page();
	transparent.pixels.data.fill(0);
	assert.deepEqual(mergeOcrBubbles(words, transparent.pixels), mergeOcrBubbles(words));
	const noisy = page(600, 600);
	for (let y = 0; y < 600; y += 2) for (let x = 0; x < 600; x += 2) noisy.paint(x, y, x + 1, y + 1);
	assert.deepEqual(mergeOcrBubbles(words, noisy.pixels), mergeOcrBubbles(words));
});
