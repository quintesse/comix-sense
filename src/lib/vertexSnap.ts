import type { Vertex } from './types/Comic';

/** Snap each coordinate to the closest adjacent vertex within the tolerance.
 * Choosing axes independently allows both connected edges to align at once. */
export function snapPolygonVertex(
	vs: Vertex[],
	index: number,
	point: Vertex,
	tolerance: Vertex
): Vertex {
	if (vs.length < 3 || !vs[index]) return { ...point };
	const neighbours = [vs[(index + vs.length - 1) % vs.length], vs[(index + 1) % vs.length]];
	const result = { ...point };
	for (const axis of ['x', 'y'] as const) {
		const nearest = neighbours.reduce((a, b) =>
			Math.abs(a[axis] - point[axis]) <= Math.abs(b[axis] - point[axis]) ? a : b
		);
		if (Math.abs(nearest[axis] - point[axis]) <= tolerance[axis]) result[axis] = nearest[axis];
	}
	return result;
}

export function edgeAlignment(a: Vertex, b: Vertex): 'horizontal' | 'vertical' | undefined {
	if (a.x === b.x && a.y === b.y) return undefined;
	if (a.y === b.y) return 'horizontal';
	if (a.x === b.x) return 'vertical';
	return undefined;
}
