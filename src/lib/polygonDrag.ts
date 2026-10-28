import type { Vertex } from './types/Comic';

const subtract = (a: Vertex, b: Vertex): Vertex => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Vertex, b: Vertex) => a.x * b.y - a.y * b.x;
const dot = (a: Vertex, b: Vertex) => a.x * b.x + a.y * b.y;
const unit = (v: Vertex): Vertex => {
	const length = Math.hypot(v.x, v.y);
	return length ? { x: v.x / length, y: v.y / length } : { x: 0, y: 0 };
};

/** Offset an edge parallel to itself. Its endpoints slide along the unchanged
 * neighbouring lines. Work from the gesture baseline to recover from zero. */
export function dragPolygonEdge(vs: Vertex[], index: number, delta: Vertex): Vertex[] {
	const result = vs.map((v) => ({ ...v }));
	if (vs.length < 3 || !vs[index]) return result;
	const wrap = (i: number) => (i + vs.length) % vs.length;
	const next = wrap(index + 1);
	const edge = unit(subtract(vs[next], vs[index]));
	if (!dot(edge, edge)) return result;
	const shifts = vs.map(() => ({ x: 0, y: 0 }));
	for (const [endpoint, anchor] of [
		[index, wrap(index - 1)],
		[next, wrap(next + 1)]
	]) {
		const adjacent = unit(subtract(vs[endpoint], vs[anchor]));
		const determinant = cross(adjacent, edge);
		// Parallel or collapsed neighbours cannot intersect an offset edge.
		if (Math.abs(determinant) < 1e-10) return result;
		const distance = cross(delta, edge) / determinant;
		shifts[endpoint] = { x: adjacent.x * distance, y: adjacent.y * distance };
	}

	// Each signed edge length varies linearly with the drag. Stop the entire
	// movement at the first zero, rather than allowing an edge to reverse.
	let fraction = 1;
	for (let i = 0; i < vs.length; i++) {
		const next = wrap(i + 1);
		const edge = subtract(vs[next], vs[i]);
		const length = Math.hypot(edge.x, edge.y);
		if (!length) continue;
		const change = dot(subtract(shifts[next], shifts[i]), unit(edge));
		if (change < 0) fraction = Math.min(fraction, length / -change);
	}
	return result.map((v, i) => ({
		x: v.x + shifts[i].x * fraction,
		y: v.y + shifts[i].y * fraction
	}));
}
