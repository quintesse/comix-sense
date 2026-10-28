import { expect, test } from '@playwright/test';
import { snapPolygonVertex, edgeAlignment } from '../src/lib/vertexSnap';

const vs = [
	{ x: 0, y: 0 },
	{ x: 100, y: 20 },
	{ x: 80, y: 80 },
	{ x: 20, y: 100 }
];
const tolerance = { x: 8, y: 8 };

test('snaps either coordinate or both to adjacent vertices without moving neighbours', () => {
	const original = structuredClone(vs);
	expect(snapPolygonVertex(vs, 2, { x: 104, y: 96 }, tolerance)).toEqual({ x: 100, y: 100 });
	expect(snapPolygonVertex(vs, 2, { x: 104, y: 60 }, tolerance)).toEqual({ x: 100, y: 60 });
	expect(snapPolygonVertex(vs, 2, { x: 60, y: 23 }, tolerance)).toEqual({ x: 60, y: 20 });
	expect(snapPolygonVertex(vs, 2, { x: 60, y: 60 }, tolerance)).toEqual({ x: 60, y: 60 });
	expect(vs).toEqual(original);
});

test('uses the closest eligible coordinate and wraps at the closing edge', () => {
	const close = [
		{ x: 0, y: 0 },
		{ x: 10, y: 20 },
		{ x: 50, y: 50 },
		{ x: 20, y: 30 }
	];
	expect(snapPolygonVertex(close, 0, { x: 17, y: 22 }, tolerance)).toEqual({ x: 20, y: 20 });
	expect(snapPolygonVertex(close, 0, { x: 40, y: 50 }, tolerance)).toEqual({ x: 40, y: 50 });
});

test('only exact, nonzero horizontal and vertical edges have alignment markers', () => {
	expect(edgeAlignment({ x: 0, y: 10 }, { x: 100, y: 10 })).toBe('horizontal');
	expect(edgeAlignment({ x: 10, y: 100 }, { x: 10, y: 0 })).toBe('vertical');
	expect(edgeAlignment({ x: 0, y: 0 }, { x: 100, y: 0.0001 })).toBeUndefined();
	expect(edgeAlignment({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeUndefined();
});
