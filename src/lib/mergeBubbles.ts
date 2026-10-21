import { BblShapeType, type BblShape, type Bubble, type Vertex } from './types/Comic';

type Box = { l: number; t: number; r: number; b: number };
type Word = { index: number; bubble: Bubble; box: Box; text: string };
const height = (b: Box) => b.b - b.t;
const cx = (b: Box) => (b.l + b.r) / 2;
const cy = (b: Box) => (b.t + b.b) / 2;
const union = (a: Box, b: Box): Box => ({
	l: Math.min(a.l, b.l),
	t: Math.min(a.t, b.t),
	r: Math.max(a.r, b.r),
	b: Math.max(a.b, b.b)
});
function median(values: number[]) {
	const sorted = values.toSorted((a, b) => a - b);
	return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}
class Line {
	constructor(public words: Word[]) {}
	get box() {
		return this.words.map((word) => word.box).reduce(union);
	}
	get height() {
		return median(this.words.map((word) => height(word.box)));
	}
	get center() {
		return median(this.words.map((word) => cy(word.box)));
	}
}
function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	const left = Object.entries(a),
		right = Object.entries(b);
	return (
		left.length === right.length &&
		left.every(
			([key, value]) => Object.hasOwn(b, key) && equal(value, (b as Record<string, unknown>)[key])
		)
	);
}
const compatible = (a: Word, b: Word) =>
	a.bubble.lang === b.bubble.lang && equal(a.bubble.style, b.bubble.style);
const punctuation = (text: string) => text.length > 0 && !/[\p{L}\p{Nd}]/u.test(text);
function rows(input: Word[]): Line[] {
	const sorted = input.toSorted(
		(a, b) =>
			Number(punctuation(a.text)) - Number(punctuation(b.text)) ||
			cy(a.box) - cy(b.box) ||
			a.box.l - b.box.l ||
			a.index - b.index
	);
	const result: Line[] = [];
	for (const word of sorted) {
		let best: Line | undefined,
			distance = Infinity;
		for (const row of result) {
			const h = Math.max(height(word.box), row.height);
			const d = Math.abs(cy(word.box) - row.center);
			const smallPunctuation =
				punctuation(word.text) &&
				height(word.box) <= row.height &&
				row.words.some(
					(w) =>
						!punctuation(w.text) &&
						Math.min(w.box.b, word.box.b) >= Math.max(w.box.t, word.box.t) &&
						Math.max(w.box.l, word.box.l) - Math.min(w.box.r, word.box.r) <= 0.35 * height(w.box)
				);
			if (
				compatible(word, row.words[0]) &&
				(smallPunctuation ||
					(Math.min(height(word.box), row.height) >= 0.55 * h && d <= 0.42 * h)) &&
				d < distance
			) {
				best = row;
				distance = d;
			}
		}
		if (best) best.words.push(word);
		else result.push(new Line([word]));
	}
	return result;
}
function runs(row: Line): Line[] {
	row.words.sort((a, b) => a.box.l - b.box.l || a.index - b.index);
	const result: Line[] = [];
	let current: Line | undefined;
	for (const word of row.words) {
		if (!current || word.box.l - current.box.r > 0.65 * row.height) {
			current = new Line([]);
			result.push(current);
		}
		current.words.push(word);
	}
	return result;
}
function split(line: Line, all: Line[]): Line[] {
	const cuts = new Set<number>(),
		h = line.height,
		box = line.box;
	for (const left of all)
		for (const right of all) {
			if (left === line || right === line || left === right) continue;
			const a = left.box,
				b = right.box;
			if (
				b.l - a.r < 0.9 * h ||
				b.l - a.r > 3 * h ||
				Math.abs(left.center - right.center) > 0.4 * h ||
				Math.abs(line.center - left.center) > 1.65 * h ||
				Math.abs(line.center - left.center) < 0.6 * h ||
				cx(a) <= box.l ||
				cx(b) >= box.r ||
				!compatible(line.words[0], left.words[0]) ||
				!compatible(line.words[0], right.words[0])
			)
				continue;
			const gutter = (a.r + b.l) / 2;
			let best = -1,
				score = -Infinity;
			for (let i = 1; i < line.words.length; i++) {
				const prev = line.words[i - 1].box,
					next = line.words[i].box;
				const x = (prev.r + next.l) / 2,
					gap = next.l - prev.r;
				if (x < a.r - 1.5 * h || x > b.l + 1.5 * h || x <= cx(a) || x >= cx(b) || gap < -0.25 * h)
					continue;
				const value = gap - 0.08 * Math.abs(x - gutter);
				if (value > score) {
					score = value;
					best = i;
				}
			}
			if (best > 0) cuts.add(best);
		}
	const result: Line[] = [];
	let start = 0;
	for (const cut of [...cuts].sort((a, b) => a - b)) {
		result.push(new Line(line.words.slice(start, cut)));
		start = cut;
	}
	result.push(new Line(line.words.slice(start)));
	return result;
}
function continuation(upper: Line, lower: Line) {
	const a = upper.box,
		b = lower.box,
		h = Math.min(upper.height, lower.height);
	const overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l),
		gap = b.t - a.b;
	if (
		!compatible(upper.words[0], lower.words[0]) ||
		h <= 0 ||
		Math.max(upper.height, lower.height) > 1.9 * h ||
		lower.center - upper.center < 0.65 * h ||
		gap < -0.5 * h ||
		gap > 0.65 * h ||
		overlap <= 0
	)
		return Infinity;
	const alignment = Math.min(Math.abs(cx(a) - cx(b)), Math.abs(a.l - b.l), Math.abs(a.r - b.r)) / h;
	return alignment > 2 ? Infinity : Math.max(0, gap) / h + 0.2 * alignment;
}
function text(line: Line) {
	let output = '',
		previous = '';
	for (const word of line.words) {
		const value = word.text;
		if (!value) continue;
		const closing = /^[.,!?;:%…，。！？；：、)\]}>»”’]+$/.test(value) || value === '-';
		const opening = /^[(\[<{«“‘]+$/.test(previous);
		if (output && !closing && !opening) output += ' ';
		output += value;
		previous = value;
	}
	return output;
}
function boxShape(box: Box): BblShape {
	return {
		type: BblShapeType.box,
		vs: [
			{ x: box.l, y: box.t },
			{ x: box.r, y: box.b }
		]
	};
}
function signedArea(points: Vertex[]) {
	return (
		points.reduce((sum, a, i) => {
			const b = points[(i + 1) % points.length];
			return sum + a.x * b.y - b.x * a.y;
		}, 0) / 2
	);
}

/** Orthogonal rectangle union replaces java.awt.geom.Area; holes are filled and
 * disconnected components fall back to the enclosing box, as in the Java tool. */
function rectangleOutline(edges: number[][], enclosing: Box): BblShape {
	const xs = [...new Set(edges.flatMap((b) => [b[0], b[2]]))].sort((a, b) => a - b);
	const ys = [...new Set(edges.flatMap((b) => [b[1], b[3]]))].sort((a, b) => a - b);
	const cells = ys
		.slice(1)
		.map((_, y) =>
			xs
				.slice(1)
				.map((_, x) =>
					edges.some(
						(b) => b[0] <= xs[x] && b[2] >= xs[x + 1] && b[1] <= ys[y] && b[3] >= ys[y + 1]
					)
				)
		);
	type Edge = { from: Vertex; to: Vertex; direction: number };
	const remaining = new Set<Edge>(),
		outgoing = new Map<string, Edge[]>();
	const key = (p: Vertex) => `${p.x},${p.y}`;
	function add(x1: number, y1: number, x2: number, y2: number, direction: number) {
		const edge = { from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, direction };
		remaining.add(edge);
		const list = outgoing.get(key(edge.from)) ?? [];
		list.push(edge);
		outgoing.set(key(edge.from), list);
	}
	for (let y = 0; y < cells.length; y++)
		for (let x = 0; x < cells[y].length; x++) {
			if (!cells[y][x]) continue;
			if (!cells[y - 1]?.[x]) add(xs[x], ys[y], xs[x + 1], ys[y], 0);
			if (!cells[y]?.[x + 1]) add(xs[x + 1], ys[y], xs[x + 1], ys[y + 1], 1);
			if (!cells[y + 1]?.[x]) add(xs[x + 1], ys[y + 1], xs[x], ys[y + 1], 2);
			if (!cells[y]?.[x - 1]) add(xs[x], ys[y + 1], xs[x], ys[y], 3);
		}
	const contours: Vertex[][] = [];
	while (remaining.size) {
		const first = remaining.values().next().value!;
		const contour: Vertex[] = [];
		let edge = first;
		do {
			contour.push(edge.from);
			remaining.delete(edge);
			if (key(edge.to) === key(first.from)) break;
			const candidates = (outgoing.get(key(edge.to)) ?? []).filter((candidate) =>
				remaining.has(candidate)
			);
			const incoming = edge.direction;
			// At point contacts, turn right to keep separate contours separate.
			candidates.sort(
				(a, b) =>
					[1, 0, 3, 2].indexOf((a.direction - incoming + 4) % 4) -
					[1, 0, 3, 2].indexOf((b.direction - incoming + 4) % 4)
			);
			if (!candidates.length) return boxShape(enclosing);
			edge = candidates[0];
		} while (true);
		contours.push(contour);
	}
	if (!contours.length) return boxShape(enclosing);
	let contour = contours.reduce((a, b) =>
		Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b
	);
	// Positive contours are outer boundaries; negative contours are holes.
	if (contours.some((c) => c !== contour && signedArea(c) > 0)) return boxShape(enclosing);
	let changed = true;
	while (changed && contour.length > 4) {
		changed = false;
		for (let i = 0; i < contour.length; i++) {
			const a = contour[(i + contour.length - 1) % contour.length],
				b = contour[i],
				c = contour[(i + 1) % contour.length];
			if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
				contour.splice(i, 1);
				changed = true;
				break;
			}
		}
	}
	if (contour.length === 4)
		return boxShape({
			l: Math.min(...edges.map((b) => b[0])),
			t: Math.min(...edges.map((b) => b[1])),
			r: Math.max(...edges.map((b) => b[2])),
			b: Math.max(...edges.map((b) => b[3]))
		});
	if (signedArea(contour) < 0) contour.reverse();
	let start = 0;
	for (let i = 1; i < contour.length; i++)
		if (
			contour[i].y < contour[start].y ||
			(contour[i].y === contour[start].y && contour[i].x < contour[start].x)
		)
			start = i;
	contour = [...contour.slice(start), ...contour.slice(0, start)];
	return { type: BblShapeType.poly, vs: contour };
}
function outline(lines: Line[]): BblShape {
	const tolerance = 0.25 * median(lines.map((line) => line.height));
	const edges = lines.map((line) => {
		const b = line.box;
		return [b.l, b.t, b.r, b.b];
	});
	for (let axis = 0; axis < 4; axis++) {
		const order = edges.map((_, i) => i).sort((a, b) => edges[a][axis] - edges[b][axis]);
		for (let start = 0; start < order.length;) {
			let end = start + 1;
			const low = edges[order[start]][axis];
			while (end < order.length && edges[order[end]][axis] - low <= tolerance) end++;
			const target = axis < 2 ? low : edges[order[end - 1]][axis];
			for (let i = start; i < end; i++) edges[order[i]][axis] = target;
			start = end;
		}
	}
	const original = edges.map((b) => [...b]);
	for (let i = 0; i < edges.length; i++)
		for (let j = 0; j < edges.length; j++) {
			const a = original[i],
				b = original[j];
			if (
				a[3] < b[1] &&
				b[1] - a[3] <= 0.65 * Math.min(lines[i].height, lines[j].height) &&
				Math.min(a[2], b[2]) > Math.max(a[0], b[0])
			) {
				const middle = (a[3] + b[1]) / 2;
				edges[i][3] = Math.max(edges[i][3], middle);
				edges[j][1] = Math.min(edges[j][1], middle);
			}
		}
	return rectangleOutline(edges, lines.map((line) => line.box).reduce(union));
}

/** Port of tools/bubblemerge.java, operating on a single page without mutating OCR. */
export function mergeBubbles(bubbles: readonly Bubble[]): Bubble[] {
	const words: Word[] = bubbles.map((bubble, index) => {
		const { type, vs } = bubble.shape;
		if (
			!((type === 'box' && vs.length === 2) || (type === 'poly' && vs.length >= 3)) ||
			!vs.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))
		)
			throw new Error('Expected box or polygon with valid vertices.');
		return {
			bubble,
			index,
			text: bubble.text ?? '',
			box: {
				l: Math.min(...vs.map((v) => v.x)),
				t: Math.min(...vs.map((v) => v.y)),
				r: Math.max(...vs.map((v) => v.x)),
				b: Math.max(...vs.map((v) => v.y))
			}
		};
	});
	const initial = rows(words).flatMap(runs);
	const lines = initial
		.flatMap((line) => split(line, initial))
		.sort((a, b) => a.box.t - b.box.t || a.box.l - b.box.l);
	const n = lines.length,
		parent = lines.map((_, i) => i);
	function root(i: number): number {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	}
	const below = Array<number>(n).fill(-1),
		above = Array<number>(n).fill(-1);
	const downCost = Array<number>(n).fill(Infinity),
		upCost = Array<number>(n).fill(Infinity);
	const edges: { a: number; b: number }[] = [];
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++) {
			const cost = continuation(lines[i], lines[j]);
			if (!Number.isFinite(cost)) continue;
			edges.push({ a: i, b: j });
			if (cost < downCost[i]) {
				downCost[i] = cost;
				below[i] = j;
			}
			if (cost < upCost[j]) {
				upCost[j] = cost;
				above[j] = i;
			}
		}
	for (const { a, b } of edges) if (below[a] === b && above[b] === a) parent[root(b)] = root(a);
	for (let j = 0; j < n; j++) {
		const i = above[j];
		if (i < 0 || below[i] < 0 || below[i] === j) continue;
		const upper = lines[i],
			lower = lines[j],
			sibling = lines[below[i]],
			a = upper.box,
			b = lower.box,
			c = sibling.box,
			h = upper.height;
		if (
			above[below[i]] === i &&
			Math.abs(lower.center - sibling.center) <= 0.4 * h &&
			b.l >= a.l - 0.5 * h &&
			b.r <= a.r + 0.5 * h &&
			c.l >= a.l - 0.5 * h &&
			c.r <= a.r + 0.5 * h
		)
			parent[root(j)] = root(i);
	}
	const groups = new Map<number, Line[]>();
	for (let i = 0; i < n; i++) {
		const group = groups.get(root(i)) ?? [];
		group.push(lines[i]);
		groups.set(root(i), group);
	}
	let remaining = [...groups.values()];
	const ordered: Line[][] = [];
	while (remaining.length) {
		const top = Math.min(...remaining.map((g) => g[0].box.t)),
			h = median(remaining.map((g) => g[0].height));
		const band = remaining
			.filter((g) => g[0].box.t <= top + 0.5 * h)
			.sort((a, b) => Math.min(...a.map((l) => l.box.l)) - Math.min(...b.map((l) => l.box.l)));
		ordered.push(...band);
		remaining = remaining.filter((g) => !band.includes(g));
	}
	return ordered.map((group) => {
		const members = group.flatMap((line) => line.words);
		const first = members.reduce((a, b) => (a.index < b.index ? a : b));
		const merged: Bubble = JSON.parse(JSON.stringify(first.bubble));
		if (members.length > 1) {
			const textRows = rows(members).sort((a, b) => a.center - b.center);
			for (const row of textRows) row.words.sort((a, b) => a.box.l - b.box.l);
			merged.text = textRows.map(text).join('\n');
			merged.shape = outline(group);
		}
		return merged;
	});
}
