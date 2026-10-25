import { test, expect } from '@playwright/test';
import {
	BblShapeType,
	bounds,
	textBounds,
	separateText,
	convertMask,
	validLayout,
	type Bubble
} from '../src/lib/types/Comic';
import { Diagnostics, parseDocument } from '../src/lib/bbl/metadata';
import { mergeBubbles } from '../src/lib/mergeBubbles';

const bubble = (): Bubble => ({
	text: 'Hello',
	style: { fill: '#fff4cc' },
	shape: {
		type: BblShapeType.poly,
		vs: [
			{ x: 80, y: 80 },
			{ x: 300, y: 90 },
			{ x: 280, y: 190 },
			{ x: 90, y: 180 }
		]
	}
});

test('legacy bounds, separation, conversion and relinking preserve artwork and typography', () => {
	const b = bubble();
	const original = structuredClone(b);
	expect(textBounds(b)).toEqual(bounds(b.shape.vs));
	expect(b).not.toHaveProperty('layout');
	separateText(b);
	expect(textBounds(b)).toEqual(bounds(b.shape.vs));
	expect(b.shape).toEqual(original.shape);
	b.shape.vs[0].x = 10;
	expect(textBounds(b).x1).toBe(80);
	const layout = structuredClone(b.layout);
	convertMask(b, BblShapeType.box);
	expect(b.style).toEqual(original.style);
	expect(b.layout).toEqual(layout);
	convertMask(b, BblShapeType.poly);
	expect(b.style).toEqual(original.style);
	expect(b.layout).toEqual(layout);
	delete b.layout;
	expect(textBounds(b).x1).toBe(10);
	expect(b.text).toBe('Hello');
});

test('optional layout accepts reversed corners and retains malformed source metadata with diagnostics', () => {
	const good = {
		type: 'box',
		vs: [
			{ x: 500, y: 600 },
			{ x: 400, y: 300 }
		]
	};
	expect(validLayout(good)).toBe(true);
	for (const layout of [
		null,
		{},
		{ type: 'poly', vs: good.vs },
		{
			type: 'box',
			vs: [
				{ x: 0, y: 0 },
				{ x: 0, y: 10 }
			]
		},
		{
			type: 'box',
			vs: [
				{ x: 0, y: 0 },
				{ x: Infinity, y: 10 }
			]
		},
		{ type: 'box', vs: [...good.vs, ...good.vs] }
	]) {
		const warnings: string[] = [];
		const diagnostics = new Diagnostics();
		diagnostics.warn = (context, reason, recovery) => {
			warnings.push(`${context}: ${reason}; ${recovery}`);
		};
		const raw = { ...bubble(), layout };
		const parsed = parseDocument({ pages: [{ bubbles: [raw] }] }, 'page.en.bbl', false, diagnostics)
			.pages[0].bubbles![0];
		expect(textBounds(parsed)).toEqual(bounds(raw.shape.vs));
		expect(parsed.layout).toEqual(layout);
		expect(warnings).toEqual([expect.stringContaining('invalid optional layout')]);
	}
});

test('grouping preserves independent placements and mask styles without aliasing', () => {
	const a = bubble(),
		b = bubble();
	separateText(a);
	expect(mergeBubbles([a, b])).toHaveLength(2);
	expect(mergeBubbles([a, b]).find((b) => b.layout)?.layout).toEqual(a.layout);
});
