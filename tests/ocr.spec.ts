import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { visionToBubbles } from '../src/lib/ocr';
import { mergeBubbles } from '../src/lib/mergeBubbles';
import { BblShapeType, type Bubble } from '../src/lib/types/Comic';

test('OCR conversion retains fixture text and bounds while preserving original polygons', () => {
	const input = JSON.parse(fs.readFileSync('tools/SW-A070-P09-ocr.json', 'utf8'));
	const expected = JSON.parse(fs.readFileSync('tools/SW-A070-P09-ocr.bbl', 'utf8'));
	const result = visionToBubbles(input);
	expect({
		...result,
		bubbles: result.bubbles.map((bubble) => ({
			...bubble,
			shape: {
				type: 'box',
				vs: [
					{
						x: Math.min(...bubble.shape.vs.map((v) => v.x)),
						y: Math.min(...bubble.shape.vs.map((v) => v.y))
					},
					{
						x: Math.max(...bubble.shape.vs.map((v) => v.x)),
						y: Math.max(...bubble.shape.vs.map((v) => v.y))
					}
				]
			}
		}))
	}).toEqual({
		lang: expected.lang,
		bubbles: expected.pages[0].bubbles
	});
	result.bubbles.forEach((bubble, i) => {
		if (bubble.shape.type === 'poly')
			expect(bubble.shape.vs).toEqual(
				input.textAnnotations[i + 1].boundingPoly.vertices.map((v: { x?: number; y?: number }) => ({
					x: v.x ?? 0,
					y: v.y ?? 0
				}))
			);
	});
});

test('OCR handles empty recognition, omitted zero coordinates and per-word locales', () => {
	expect(visionToBubbles({})).toEqual({ lang: 'und', bubbles: [] });
	expect(
		visionToBubbles({
			textAnnotations: [
				{ description: 'aggregate', locale: 'nl' },
				{
					description: 'word',
					locale: 'en',
					boundingPoly: { vertices: [{}, { x: 20, y: 30 }, { x: 10, y: 40 }] }
				}
			]
		}).bubbles
	).toEqual([
		{
			text: 'word',
			lang: 'en',
			shape: {
				type: 'poly',
				vs: [
					{ x: 0, y: 0 },
					{ x: 20, y: 30 },
					{ x: 10, y: 40 }
				]
			}
		}
	]);
	expect(() => visionToBubbles({ error: { message: 'denied' } })).toThrow('denied');
	expect(() => visionToBubbles({ textAnnotations: [{}, { description: 'broken' }] })).toThrow(
		'no vertices'
	);
});

test('OCR keeps exact axis-aligned rectangles as boxes and rotated or skewed vertices as polygons', () => {
	const rectangle = [
		{ x: 10, y: 20 },
		{ x: 50, y: 20 },
		{ x: 50, y: 40 },
		{ x: 10, y: 40 }
	];
	const rotated = [
		{ x: 10, y: 20 },
		{ x: 50, y: 10 },
		{ x: 55, y: 30 },
		{ x: 15, y: 40 }
	];
	const skewed = [
		{ x: 10, y: 20 },
		{ x: 50, y: 20 },
		{ x: 49.999, y: 40 },
		{ x: 10, y: 40 }
	];
	const shapes = [rectangle, [...rectangle].reverse(), rotated, skewed];
	const input = {
		textAnnotations: [
			{ description: 'aggregate' },
			...shapes.map((vertices) => ({ description: 'word', boundingPoly: { vertices } }))
		]
	};
	const snapshot = JSON.stringify(input);
	expect(visionToBubbles(input).bubbles.map((b) => b.shape)).toEqual([
		{
			type: 'box',
			vs: [
				{ x: 10, y: 20 },
				{ x: 50, y: 40 }
			]
		},
		{
			type: 'box',
			vs: [
				{ x: 10, y: 20 },
				{ x: 50, y: 40 }
			]
		},
		{ type: 'poly', vs: rotated },
		{ type: 'poly', vs: skewed }
	]);
	expect(JSON.stringify(input)).toBe(snapshot);
});

test('merge restores sample polygon outlines without changing original OCR', () => {
	const input = JSON.parse(fs.readFileSync('tools/SW-A070-P09-ocr.bbl', 'utf8')).pages[0].bubbles;
	const expected = JSON.parse(fs.readFileSync('tools/SW-A070-P09-mrg.bbl', 'utf8')).pages[0]
		.bubbles;
	const snapshot = JSON.stringify(input);
	expect(mergeBubbles(input)).toEqual(
		expected.map((bubble: Bubble) => ({
			...bubble,
			text: bubble.text.replaceAll('-\n', '-').replace(/\s+/gu, ' ').trim()
		}))
	);
	expect(JSON.stringify(input)).toBe(snapshot);
});

function word(text: string, l: number, t: number, r: number, b: number): Bubble {
	return {
		text,
		shape: {
			type: BblShapeType.box,
			vs: [
				{ x: l, y: t },
				{ x: r, y: b }
			]
		}
	};
}

test('merge retains punctuation and splits while outlining irregular groups with polygons', () => {
	const punctuation = mergeBubbles([
		word('Hello', 0, 0, 40, 20),
		word(',', 41, 15, 44, 20),
		word('world', 48, 0, 90, 20),
		word('!', 91, 0, 95, 20),
		word('Next', 20, 25, 65, 45)
	]);
	expect(punctuation.map((b) => b.text)).toEqual(['Hello, world! Next']);
	expect(
		mergeBubbles([
			word('A', 0, 0, 40, 20),
			word('B', 42, 0, 82, 20),
			word('a', 0, 25, 28, 45),
			word('b', 54, 25, 82, 45)
		]).map((b) => b.text)
	).toEqual(['A a', 'B b']);
	const irregular = mergeBubbles([
		word('wide', 0, 0, 180, 20),
		word('left', 0, 25, 30, 45),
		word('right', 140, 25, 180, 45)
	]);
	expect(irregular).toHaveLength(1);
	expect(irregular[0].text).toBe('wide left right');
	expect(irregular[0].shape.type).toBe(BblShapeType.poly);
	expect(irregular[0].shape.vs).toHaveLength(8);
	const singleton = { ...word(' single\npolygon ', 300, 0, 400, 20), shape: irregular[0].shape };
	expect(mergeBubbles([singleton])).toEqual([{ ...singleton, text: 'single polygon' }]);
	expect(mergeBubbles([])).toEqual([]);
	expect(mergeBubbles([word('', 0, 0, 0, 0)])).toEqual([word('', 0, 0, 0, 0)]);
	const english = { ...word('English', 0, 0, 40, 20), lang: 'en' };
	const dutch = { ...word('Dutch', 41, 0, 80, 20), lang: 'nl' };
	expect(mergeBubbles([english, dutch])).toHaveLength(2);
});

test('merged sample is invariant under shuffled input, scaling and translation', () => {
	const input: Bubble[] = JSON.parse(fs.readFileSync('tools/SW-A070-P09-ocr.bbl', 'utf8')).pages[0]
		.bubbles;
	const expected = mergeBubbles(input);
	for (const scale of [0.25, 1, 4]) {
		const transform = (bubbles: Bubble[]) =>
			bubbles.map((bubble) => ({
				...bubble,
				shape: {
					...bubble.shape,
					vs: bubble.shape.vs.map((v) => ({ x: v.x * scale + 17, y: v.y * scale + 31 }))
				}
			}));
		const shuffled = [...input];
		let seed = 73;
		for (let i = shuffled.length - 1; i > 0; i--) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			const j = seed % (i + 1);
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		expect(mergeBubbles(transform(shuffled))).toEqual(transform(expected));
	}
});

test('merge retains metadata, separates styles, and produces independent editable results', () => {
	const input = [
		{
			...word('one', 0, 0, 40, 20),
			lang: 'nl',
			font: { size: 18 },
			style: { fill: 'red' }
		},
		{
			...word('two', 42, 0, 80, 20),
			lang: 'nl',
			style: { fill: 'red' }
		}
	];
	const merged = mergeBubbles(input);
	expect(merged).toHaveLength(1);
	expect(merged[0]).toMatchObject({
		text: 'one two',
		lang: 'nl',
		font: { size: 18 },
		style: { fill: 'red' }
	});
	merged[0].shape.vs[0].x = 123;
	merged[0].style!.fill = 'blue';
	expect(input[0].shape.vs[0].x).toBe(0);
	expect(input[0].style.fill).toBe('red');
	input[1].style.fill = 'black';
	expect(mergeBubbles(input)).toHaveLength(2);
});

test('merged OCR text removes source whitespace formatting, including singleton and empty OCR boxes', () => {
	const input = [
		word('  Hello\r\nworld\t ', 0, 0, 90, 20),
		word(' !\n ', 91, 0, 95, 20),
		word(' Next\u2028line ', 20, 25, 65, 45),
		word(' Single\n\nbox\rwith\tspaces ', 300, 0, 500, 20),
		word('\r\n \t', 600, 0, 650, 20)
	];
	const snapshot = JSON.stringify(input);
	expect(mergeBubbles(input).map((bubble) => bubble.text)).toEqual([
		'Hello world! Next line',
		'Single box with spaces',
		''
	]);
	expect(JSON.stringify(input)).toBe(snapshot);
});

test('merged OCR joins hyphenated line breaks without spaces while preserving hyphens for cleanup', () => {
	const input = [word('A long-', 0, 0, 100, 20), word('word here', 0, 25, 100, 45)];
	expect(mergeBubbles(input).map((bubble) => bubble.text)).toEqual(['A long-word here']);
	for (const newline of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
		expect(mergeBubbles([word(` well- ${newline}  known `, 0, 0, 100, 20)])[0].text).toBe(
			'well-known'
		);
	}
	// A space that was not a line break stays a space.
	expect(mergeBubbles([word('well- known', 0, 0, 100, 20)])[0].text).toBe('well- known');
	expect(mergeBubbles([word('well-', 0, 0, 40, 20), word('known', 42, 0, 80, 20)])[0].text).toBe(
		'well- known'
	);
	expect(input.map((bubble) => bubble.text)).toEqual(['A long-', 'word here']);
});
