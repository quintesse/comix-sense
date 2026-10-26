import { bounds, type Bubble, type Vertex } from './types/Comic';
import type { StrStrMap } from './types/funcs';

/** Transient colour memory survives closing settings without persisting extra metadata. */
export const outlineColours = new WeakMap<Bubble, string>();

export function validCornerRadius(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) &&
		Number.isFinite(Number(value)) &&
		Number(value) >= 0
	);
}
export function cornerRadius(style?: StrStrMap): number {
	return validCornerRadius(style?.cornerRadius) ? Number(style!.cornerRadius) : 0;
}
export function maskStyle(style?: StrStrMap): string {
	return Object.entries(style ?? {})
		.filter(([key]) => key !== 'cornerRadius')
		.map(([key, value]) => `${key}:${value};`)
		.join('');
}
export function boxRadius(vs: Vertex[], radius: number): number {
	const b = bounds(vs);
	return Math.min(radius, b.w / 2, b.h / 2);
}

/** Circular fillets tangent to incident edges. Each tangent distance is capped at
 * half either incident edge, so neighboring arcs cannot overlap. Only the render
 * copy drops consecutive duplicates; stored vertices and editing handles survive.
 */
export function roundedPolygon(vs: Vertex[], radius: number): string {
	const vertices = vs.filter((v, i) => !i || v.x !== vs[i - 1].x || v.y !== vs[i - 1].y);
	if (
		vertices.length > 1 &&
		vertices[0].x === vertices.at(-1)!.x &&
		vertices[0].y === vertices.at(-1)!.y
	)
		vertices.pop();
	if (!vertices.length) return '';
	const corners = vertices.map((v, i) => {
		const prev = vertices[(i + vertices.length - 1) % vertices.length],
			next = vertices[(i + 1) % vertices.length];
		const a = Math.hypot(v.x - prev.x, v.y - prev.y),
			b = Math.hypot(next.x - v.x, next.y - v.y);
		const incoming = { x: (v.x - prev.x) / a, y: (v.y - prev.y) / a };
		const outgoing = { x: (next.x - v.x) / b, y: (next.y - v.y) / b };
		const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
		const dot = Math.max(-1, Math.min(1, incoming.x * outgoing.x + incoming.y * outgoing.y));
		const factor = Math.tan(Math.acos(dot) / 2);
		const distance = Math.min(radius * factor, a / 2, b / 2);
		if (
			!(radius > 0) ||
			!Number.isFinite(distance) ||
			!Number.isFinite(factor) ||
			Math.abs(cross) < 1e-8 ||
			distance < 1e-8
		)
			return { start: v, end: v, radius: 0, sweep: 0 };
		return {
			start: { x: v.x - incoming.x * distance, y: v.y - incoming.y * distance },
			end: { x: v.x + outgoing.x * distance, y: v.y + outgoing.y * distance },
			radius: distance / factor,
			sweep: cross > 0 ? 1 : 0
		};
	});
	const point = (v: Vertex) => `${v.x},${v.y}`;
	return (
		`M ${point(corners[0].start)} ` +
		corners
			.map(
				(c) =>
					`L ${point(c.start)} ` +
					(c.radius ? `A ${c.radius},${c.radius} 0 0 ${c.sweep} ${point(c.end)}` : '')
			)
			.join(' ') +
		' Z'
	);
}
