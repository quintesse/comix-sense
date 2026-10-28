import { test, expect } from '@playwright/test';
import { dragPolygonEdge } from '../src/lib/polygonDrag';
import type { Vertex } from '../src/lib/types/Comic';

const rectangle = [
	{ x: 0, y: 0 },
	{ x: 100, y: 0 },
	{ x: 100, y: 60 },
	{ x: 0, y: 60 }
];

function expectDirections(original: Vertex[], moved: Vertex[]) {
	for (let i = 0; i < original.length; i++) {
		const next = (i + 1) % original.length;
		const a = { x: original[next].x - original[i].x, y: original[next].y - original[i].y };
		const b = { x: moved[next].x - moved[i].x, y: moved[next].y - moved[i].y };
		expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 8);
		expect(a.x * b.x + a.y * b.y).toBeGreaterThanOrEqual(-1e-8);
	}
}

test('an edge offsets parallel to itself and slides only its endpoints', () => {
	const original = structuredClone(rectangle);
	expect(dragPolygonEdge(rectangle, 0, { x: 25, y: -20 })).toEqual([
		{ x: 0, y: -20 },
		{ x: 100, y: -20 },
		{ x: 100, y: 60 },
		{ x: 0, y: 60 }
	]);
	expect(dragPolygonEdge(rectangle, 0, { x: 25, y: 0 })).toEqual(rectangle);
	expect(rectangle).toEqual(original);
});

test('overshooting stops at zero and can recover within the gesture', () => {
	const moved = dragPolygonEdge(rectangle, 0, { x: 200, y: 120 });
	expect(moved).toEqual([
		{ x: 0, y: 60 },
		{ x: 100, y: 60 },
		{ x: 100, y: 60 },
		{ x: 0, y: 60 }
	]);
	expectDirections(rectangle, moved);
	expect(dragPolygonEdge(rectangle, 0, { x: 20, y: 6 })[0]).toEqual({ x: 0, y: 6 });
});

test('slanted, triangular and concave polygons retain every edge direction in either winding', () => {
	const polygons = [
		[
			{ x: 0, y: 0 },
			{ x: 80, y: 20 },
			{ x: 100, y: 100 },
			{ x: -10, y: 60 }
		],
		[
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 50, y: 100 }
		],
		[
			{ x: 0, y: 0 },
			{ x: 100, y: 0 },
			{ x: 50, y: 40 },
			{ x: 100, y: 80 },
			{ x: 0, y: 80 }
		]
	];
	for (const polygon of polygons) {
		for (const vs of [polygon, [...polygon].reverse()]) {
			for (let index = 0; index < vs.length; index++) {
				for (const delta of [
					{ x: 10, y: -15 },
					{ x: -500, y: 700 }
				]) {
					const moved = dragPolygonEdge(vs, index, delta);
					expectDirections(vs, moved);
					for (let i = 0; i < vs.length; i++) {
						if (![index, (index + 1) % vs.length].includes(i)) expect(moved[i]).toEqual(vs[i]);
					}
				}
			}
		}
	}
});

test('parallel and zero length edges stay finite without rotating connected edges', () => {
	const collinear = [rectangle[0], { x: 50, y: 0 }, ...rectangle.slice(1)];
	expect(dragPolygonEdge(collinear, 0, { x: 20, y: 50 })).toEqual(collinear);
	const duplicate = [rectangle[0], rectangle[0], ...rectangle.slice(1)];
	expect(dragPolygonEdge(duplicate, 0, { x: 20, y: 10 })).toEqual(duplicate);
	expect(dragPolygonEdge(duplicate, 1, { x: 20, y: 10 })).toEqual(duplicate);
});

test('a triangular edge stops when its own length reaches zero', () => {
	const triangle = [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 50, y: 100 }
	];
	const moved = dragPolygonEdge(triangle, 0, { x: 0, y: 200 });
	expect(moved).toEqual([
		{ x: 50, y: 100 },
		{ x: 50, y: 100 },
		{ x: 50, y: 100 }
	]);
	expectDirections(triangle, moved);
});
