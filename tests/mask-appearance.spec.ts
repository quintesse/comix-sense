import { test, expect } from '@playwright/test';
import {
	roundedPolygon,
	boxRadius,
	cornerRadius,
	maskStyle,
	validCornerRadius
} from '../src/lib/maskAppearance';
import { Diagnostics, parseDocument } from '../src/lib/bbl/metadata';
import { convertMask, BblShapeType, type Bubble } from '../src/lib/types/Comic';

const convex = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 80 },
	{ x: 0, y: 80 }
];
const concave = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 80 },
	{ x: 50, y: 40 },
	{ x: 0, y: 80 }
];
test('radius defaults, validation, diagnostics and CSS filtering', () => {
	expect(cornerRadius()).toBe(0);
	expect(maskStyle()).toBe('');
	for (const value of ['-1', 'NaN', 'Infinity', '', '12px', 12, null, '0xff']) {
		expect(validCornerRadius(value)).toBe(false);
		expect(cornerRadius({ cornerRadius: value as string })).toBe(0);
	}
	expect(maskStyle({ cornerRadius: '12', fill: 'red', opacity: '.6', custom: 'keep' })).toBe(
		'fill:red;opacity:.6;custom:keep;'
	);
	const diagnostics = new Diagnostics();
	const warnings: string[] = [];
	diagnostics.warn = (...args) => {
		warnings.push(args.join(' '));
	};
	const raw = {
		text: 'Hello',
		shape: { type: 'poly', vs: convex },
		style: { cornerRadius: 'bad' }
	};
	const parsed = parseDocument({ pages: [{ bubbles: [raw] }] }, 'page.en.bbl', false, diagnostics);
	expect(parsed.pages[0].bubbles![0].style).toEqual(raw.style);
	expect(warnings).toEqual([expect.stringContaining('use square corners; preserve metadata')]);
});
test('boxes clamp only rendered radius and conversion preserves appearance, layout and font', () => {
	const b: Bubble = {
		text: 'Hello',
		shape: { type: BblShapeType.poly, vs: convex },
		style: {
			cornerRadius: '999',
			fill: 'red',
			stroke: 'black',
			'stroke-width': '2',
			opacity: '.5'
		},
		font: { size: 20 },
		layout: {
			type: BblShapeType.box,
			vs: [
				{ x: 10, y: 10 },
				{ x: 40, y: 40 }
			]
		}
	};
	const original = structuredClone(b);
	expect(boxRadius(convex, 999)).toBe(40);
	convertMask(b, BblShapeType.box);
	convertMask(b, BblShapeType.poly);
	expect(b.style).toEqual(original.style);
	expect(b.layout).toEqual(original.layout);
	expect(b.font).toEqual(original.font);
});
for (const vs of [
	convex,
	concave,
	[
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 60 },
		{ x: 70, y: 60 },
		{ x: 90, y: 110 },
		{ x: 40, y: 60 },
		{ x: 0, y: 60 }
	]
]) {
	for (const vertices of [vs, [...vs].reverse()])
		test(`finite circular fillets ${JSON.stringify(vertices)}`, () => {
			const original = structuredClone(vertices);
			for (const radius of [0, 12, 1e300]) {
				const path = roundedPolygon(vertices, radius);
				expect(path).not.toMatch(/NaN|Infinity/);
				expect(path).toMatch(/^M .* Z$/);
				if (radius) expect(path).toContain('A ');
			}
			expect(vertices).toEqual(original);
		});
}
test('duplicate, collinear, reversing and very short edges stay finite', () => {
	for (const vs of [
		[],
		[{ x: 1, y: 1 }],
		[
			{ x: 0, y: 0 },
			{ x: 0, y: 0 }
		],
		[...convex, convex[0]],
		[
			{ x: 0, y: 0 },
			{ x: 1e-12, y: 0 },
			{ x: 30, y: 0 },
			{ x: 0, y: 0 }
		],
		[
			{ x: 0, y: 0 },
			{ x: 20, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 20 }
		]
	]) {
		expect(roundedPolygon(vs, 1e200)).not.toMatch(/NaN|Infinity/);
	}
	expect(roundedPolygon(convex, 12)).toContain('A 12,12 0 0 1');
	expect(roundedPolygon([...convex].reverse(), 12)).toContain('A 12,12 0 0 0');
});
