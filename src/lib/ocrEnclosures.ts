// Pixel enclosure evidence ported from the offline pilot. No artwork mutation or model calls.
import type { Bubble, BblShape, Vertex } from './types/Comic';
export type GrayPixels = { width: number; height: number; gray: Uint8Array };
type Box = { left: number; right: number; top: number; bottom: number; area: number };
type Components = { labels: Int32Array; stats: (Box | null)[] };
type Word = Pick<Bubble, 'shape' | 'text'>;
type WordGroup = { words: Word[] };

const enclosureConfiguration = Object.freeze({
	whiteThreshold: 220,
	strongInkThreshold: 130,
	outlineFringe: 1,
	closingRadii: [0, 1, 2],
	minimumStability: 0.85,
	maximumInkOvershootFraction: 0.1,
	maximumPageFraction: 0.12
});

const bounds = (vs: readonly Vertex[]) => ({
	left: Math.min(...vs.map((p) => p.x)),
	right: Math.max(...vs.map((p) => p.x)),
	top: Math.min(...vs.map((p) => p.y)),
	bottom: Math.max(...vs.map((p) => p.y))
});
const inside = (x: number, y: number, vs: readonly Vertex[]) => {
	let result = false;
	for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
		const a = vs[i],
			b = vs[j];
		if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result;
	}
	return result;
};
const vertices = (shape: BblShape) =>
	shape.type === 'box'
		? [
				shape.vs[0],
				{ x: shape.vs[1].x, y: shape.vs[0].y },
				shape.vs[1],
				{ x: shape.vs[0].x, y: shape.vs[1].y }
			]
		: shape.vs;
function hull(points: Vertex[]) {
	const p = points.sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (a: Vertex, b: Vertex, c: Vertex) =>
		(b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	const side = (items: Vertex[]) => {
		const s: Vertex[] = [];
		for (const q of items) {
			while (s.length > 1 && cross(s.at(-2)!, s.at(-1)!, q) <= 0) s.pop();
			s.push(q);
		}
		return s;
	};
	return [...side(p).slice(0, -1), ...side([...p].reverse()).slice(0, -1)];
}

// Components use eight-connectivity, matching the historical offline detector.
function components(binary: Uint8Array, width: number, height: number): Components {
	const labels = new Int32Array(binary.length),
		queue = new Int32Array(binary.length),
		stats: (Box | null)[] = [null];
	for (let index = 0; index < binary.length; index++) {
		if (!binary[index] || labels[index]) continue;
		if (stats.length > 50000) throw new Error('Artwork component budget exceeded');
		const label = stats.length;
		let head = 0,
			tail = 1,
			left = width,
			right = 0,
			top = height,
			bottom = 0;
		queue[0] = index;
		labels[index] = label;
		while (head < tail) {
			const i = queue[head++],
				x = i % width,
				y = Math.floor(i / width);
			left = Math.min(left, x);
			right = Math.max(right, x);
			top = Math.min(top, y);
			bottom = Math.max(bottom, y);
			for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++)
				for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
					const next = yy * width + xx;
					if (binary[next] && !labels[next]) {
						labels[next] = label;
						queue[tail++] = next;
					}
				}
		}
		stats.push({ left, right: right + 1, top, bottom: bottom + 1, area: tail });
	}
	return { labels, stats };
}

function morphology(
	binary: Uint8Array,
	width: number,
	height: number,
	radius: number,
	dilate: boolean
) {
	if (!radius) return binary;
	const stride = width + 1,
		integral = new Int32Array(stride * (height + 1));
	for (let y = 0; y < height; y++) {
		let row = 0;
		for (let x = 0; x < width; x++) {
			row += binary[y * width + x];
			integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
		}
	}
	const result = new Uint8Array(binary.length);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const l = Math.max(0, x - radius),
				r = Math.min(width, x + radius + 1),
				t = Math.max(0, y - radius),
				b = Math.min(height, y + radius + 1);
			const sum =
				integral[b * stride + r] -
				integral[b * stride + l] -
				integral[t * stride + r] +
				integral[t * stride + l];
			result[y * width + x] = Number(dilate ? sum > 0 : sum === (2 * radius + 1) ** 2);
		}
	return result;
}

function artworkMaps(pixels: GrayPixels, groups: WordGroup[]) {
	const { width, height, gray } = pixels,
		n = width * height;
	if (gray.length !== n) throw new Error('Artwork pixel dimensions mismatch');
	const dark = Uint8Array.from(gray, (v) => Number(v < enclosureConfiguration.whiteThreshold));
	// JPEG fringe can connect handwriting to an otherwise separate outline.
	// Find structural connectivity in strong ink; retain its original light fringe.
	const strong = Uint8Array.from(gray, (v) =>
		Number(v < enclosureConfiguration.strongInkThreshold)
	);
	const ink = components(strong, width, height),
		ocr = new Uint8Array(n);
	const shapes = groups.map((g) => g.words.map((w) => w.shape));
	let paintedArea = 0;
	for (const group of shapes)
		for (const shape of group) {
			const vs = vertices(shape),
				b = bounds(vs);
			paintedArea += (Math.ceil(b.right - b.left) + 4) * (Math.ceil(b.bottom - b.top) + 4);
			if (paintedArea > 8000000) throw new Error('Artwork word-mask budget exceeded');
			// Only analysis copies are whitened. The original pixels remain untouched.
			const expanded = hull(
				vs.flatMap((p) =>
					[-1, 1].flatMap((dx) => [-1, 2].map((dy) => ({ x: p.x + dx, y: p.y + dy })))
				)
			);
			for (
				let y = Math.max(0, Math.floor(b.top) - 1);
				y < Math.min(height, Math.ceil(b.bottom) + 3);
				y++
			)
				for (
					let x = Math.max(0, Math.floor(b.left) - 1);
					x < Math.min(width, Math.ceil(b.right) + 2);
					x++
				)
					if (inside(x + 0.5, y + 0.5, expanded)) ocr[y * width + x] = 1;
		}
	const protectedLabels = new Uint8Array(ink.stats.length);
	const outside = new Int32Array(ink.stats.length);
	for (let i = 0; i < n; i++) if (strong[i] && !ocr[i]) outside[ink.labels[i]]++;
	for (let label = 1; label < ink.stats.length; label++)
		protectedLabels[label] = Number(
			outside[label] / ink.stats[label]!.area > enclosureConfiguration.maximumInkOvershootFraction
		);
	const core = Uint8Array.from(strong, (v, i) => Number(v && protectedLabels[ink.labels[i]]));
	const fringe = morphology(core, width, height, enclosureConfiguration.outlineFringe, true);
	const wall = Uint8Array.from(dark, (v, i) => Number(v && fringe[i]));
	const maps = enclosureConfiguration.closingRadii.map((radius) => {
		const closed = radius
			? morphology(morphology(wall, width, height, radius, true), width, height, radius, false)
			: wall;
		return components(
			Uint8Array.from(closed, (v) => 1 - v),
			width,
			height
		);
	});
	return { maps };
}

function wordLabel(map: Components, word: Word, width: number, height: number) {
	const b = bounds(word.shape.vs),
		cx = (b.left + b.right) / 2,
		cy = (b.top + b.bottom) / 2;
	const votes = new Map<number, number>();
	for (const dx of [-0.4, -0.2, 0, 0.2, 0.4])
		for (const dy of [-0.3, 0, 0.3]) {
			const x = Math.round(cx + dx * (b.right - b.left)),
				y = Math.round(cy + dy * (b.bottom - b.top));
			const label = x >= 0 && y >= 0 && x < width && y < height ? map.labels[y * width + x] : 0;
			if (label) {
				votes.set(label, (votes.get(label) ?? 0) + 1);
			}
		}
	const best = [...votes].sort(
		(a, b) => b[1] - a[1] || map.stats[b[0]]!.area - map.stats[a[0]]!.area
	)[0];
	return best && best[1] >= Math.max(3, 15 * 0.6) ? best[0] : 0;
}

// A word receives an enclosure only if the same bounded area persists at
// each closing radius. Page edges, backgrounds and unstable gaps stay unknown.
export function artworkWordEnclosures(pixels: GrayPixels, groups: WordGroup[]) {
	const { width, height } = pixels;
	const { maps } = artworkMaps(pixels, groups);
	const stable = new Map<string, Box>();
	for (const group of groups)
		for (const word of group.words) {
			const labels = maps.map((map) => wordLabel(map, word, width, height));
			const regions = labels.map((l, i) => maps[i].stats[l]);
			if (
				regions.some(
					(r) =>
						!r ||
						r.left === 0 ||
						r.top === 0 ||
						r.right === width ||
						r.bottom === height ||
						r.area > width * height * enclosureConfiguration.maximumPageFraction
				)
			)
				continue;
			if (
				Math.min(...regions.map((r) => r!.area)) / Math.max(...regions.map((r) => r!.area)) <
				enclosureConfiguration.minimumStability
			)
				continue;
			stable.set(labels.join('/'), regions[0]!);
		}
	return groups.map((g) =>
		g.words.map((word) => {
			const b = bounds(word.shape.vs),
				votes = new Map<string, number>();
			for (let j = 0; j < 5; j++)
				for (let i = 0; i < 13; i++) {
					const x = Math.floor(b.left + ((i + 0.5) * (b.right - b.left)) / 13),
						y = Math.floor(b.top + ((j + 0.5) * (b.bottom - b.top)) / 5);
					if (x < 0 || x >= width || y < 0 || y >= height) continue;
					const key = maps.map((m) => m.labels[y * width + x]).join('/');
					if (stable.has(key)) votes.set(key, (votes.get(key) ?? 0) + 1);
				}
			const labels = maps.map((map) => wordLabel(map, word, width, height)).join('/');
			const alternatives = [...votes]
				.filter(([, v]) => v >= 7)
				.sort((a, b) => b[1] - a[1])
				.map(([key]) => key);
			return { key: stable.has(labels) ? labels : null, alternatives };
		})
	);
}
