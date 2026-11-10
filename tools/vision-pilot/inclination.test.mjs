import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOcrBubbles } from '../../src/lib/ocr.ts';

const box = (text, x, y, width, height) => ({
	text,
	lang: 'en',
	shape: { type: 'box', vs: [{ x, y }, { x: x + width, y: y + height }] }
});

function rotatedWords(degrees) {
	const angle = (degrees * Math.PI) / 180;
	return [
		box('first', 0, 0, 38, 18),
		box('line', 46, 0, 28, 18),
		box('second', 0, 27, 38, 18),
		box('row', 46, 27, 28, 18)
	].map((word) => {
		const [a, b] = word.shape.vs;
		const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
		return {
			...word,
			shape: {
				type: 'poly',
				vs: corners.map(({ x, y }) => ({
					x: 100 + x * Math.cos(angle) - y * Math.sin(angle),
					y: 120 + x * Math.sin(angle) + y * Math.cos(angle)
				}))
			}
		};
	});
}

test('inclination opt-in reconstructs rows at both slopes without pixels', () => {
	for (const degrees of [-24, 24]) {
		const words = rotatedWords(degrees);
		const original = structuredClone(words);
		assert.deepEqual(mergeOcrBubbles(words, undefined, true).map((bubble) => bubble.text), [
			'first line second row'
		]);
		assert.deepEqual(words, original);
	}
});

test('shared enclosure respects printed glyph size', () => {
	const width = 200,
		height = 100,
		data = new Uint8ClampedArray(width * height * 4).fill(255);
	for (let y = 10; y < 80; y++)
		for (let x = 10; x < 170; x++)
			if (y < 13 || y >= 77 || x < 13 || x >= 167) {
				const at = (y * width + x) * 4;
				data[at] = data[at + 1] = data[at + 2] = 0;
			}
	const words = [box('LARGE', 25, 20, 45, 27), box('tiny', 83, 34, 24, 11)];
	assert.deepEqual(
		mergeOcrBubbles(words, { width, height, data }, true).map((bubble) => bubble.text),
		['LARGE', 'tiny']
	);
});
