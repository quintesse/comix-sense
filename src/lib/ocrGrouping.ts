import type { Bubble, BblShape } from './types/Comic';
import {
	analyzeMergeBubbles,
	analyzeOrientedMergeBubbles,
	assembleEnclosedWords
} from './mergeBubbles';
import { artworkWordEnclosures, type GrayPixels } from './ocrEnclosures';

/** Original image coordinates and RGBA bytes, as returned by canvas.getImageData(). */
export type OcrPixels = { width: number; height: number; data: ArrayLike<number> };
const maximumInputPixels = 16000000;
const maximumWorkingPixels = 1000000;
/** Check before allocating a browser canvas; unsupported images keep geometric grouping. */
export function canAnalyzeOcrPixels(width: number, height: number): boolean {
	return (
		Number.isSafeInteger(width) &&
		Number.isSafeInteger(height) &&
		width > 0 &&
		height > 0 &&
		width * height <= maximumInputPixels
	);
}

function raster(pixels: OcrPixels): { pixels: GrayPixels; scaleX: number; scaleY: number } {
	const scale = Math.min(1, Math.sqrt(maximumWorkingPixels / (pixels.width * pixels.height)));
	const width = Math.max(1, Math.floor(pixels.width * scale)),
		height = Math.max(1, Math.floor(pixels.height * scale));
	const gray = new Uint8Array(width * height).fill(255);
	// Pool darkest composited pixels conservatively so reduction never drops a thin wall.
	for (let y = 0; y < pixels.height; y++)
		for (let x = 0; x < pixels.width; x++) {
			const i = (y * pixels.width + x) * 4,
				alpha = pixels.data[i + 3] / 255;
			const light =
				255 * (1 - alpha) +
				alpha * (0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]);
			const at =
				Math.min(height - 1, Math.floor((y * height) / pixels.height)) * width +
				Math.min(width - 1, Math.floor((x * width) / pixels.width));
			gray[at] = Math.min(gray[at], Math.round(light));
		}
	return {
		pixels: { width, height, gray },
		scaleX: width / pixels.width,
		scaleY: height / pixels.height
	};
}
const box = (shape: BblShape) => ({
	left: Math.min(...shape.vs.map((v) => v.x)),
	right: Math.max(...shape.vs.map((v) => v.x)),
	top: Math.min(...shape.vs.map((v) => v.y)),
	bottom: Math.max(...shape.vs.map((v) => v.y))
});
function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	const entries = Object.entries(a);
	return (
		entries.length === Object.keys(b).length &&
		entries.every(([k, v]) => Object.hasOwn(b, k) && equal(v, (b as Record<string, unknown>)[k]))
	);
}
function compatible(a: Bubble, b: Bubble) {
	return (
		a.layout === undefined &&
		b.layout === undefined &&
		a.lang === b.lang &&
		equal(a.style, b.style) &&
		equal(a.font, b.font)
	);
}
function neighbors(a: number[], b: number[], words: readonly Bubble[]) {
	const bounds = (indexes: number[]) => {
		const boxes = indexes.map((i) => box(words[i].shape));
		return {
			left: Math.min(...boxes.map((b) => b.left)),
			right: Math.max(...boxes.map((b) => b.right)),
			top: Math.min(...boxes.map((b) => b.top)),
			bottom: Math.max(...boxes.map((b) => b.bottom))
		};
	};
	const heights = [...a, ...b]
		.map((i) => {
			const b = box(words[i].shape);
			return b.bottom - b.top;
		})
		.sort((a, b) => a - b);
	const h = heights[Math.floor(heights.length / 2)],
		x = bounds(a),
		y = bounds(b);
	const dx = Math.max(x.left - y.right, y.left - x.right),
		dy = Math.max(x.top - y.bottom, y.top - x.bottom);
	return (dx <= h && dy <= 0) || (dy <= h && dx <= 0);
}
type Piece = { key: string | null; indexes: number[]; sources: number[] };
// Offline gate for new joins only. OCR quadrilateral height is projected onto
// its short-edge normal; boxes use their vertical extent. Ignore punctuation.
function printedHeight(word: Bubble): number {
	const vs = word.shape.vs;
	if (word.shape.type !== 'poly' || vs.length !== 4)
		return box(word.shape).bottom - box(word.shape).top;
	const dx = vs[1].x - vs[0].x,
		dy = vs[1].y - vs[0].y;
	const norm = Math.hypot(dx, dy);
	if (!norm) return box(word.shape).bottom - box(word.shape).top;
	const values = vs.map((v) => (-dy * v.x + dx * v.y) / norm);
	return Math.max(...values) - Math.min(...values);
}
function sizeCompatible(a: number[], b: number[], words: readonly Bubble[]): boolean {
	const heights = (indexes: number[]) =>
		indexes
			.filter((i) => /[\p{L}\p{Nd}]/u.test(words[i].text ?? ''))
			.map((i) => printedHeight(words[i]))
			.filter((value) => value > 0)
			.sort((x, y) => x - y);
	const left = heights(a),
		right = heights(b);
	if (!left.length || !right.length) return true;
	const x = left[Math.floor(left.length / 2)],
		y = right[Math.floor(right.length / 2)];
	return Math.max(x, y) <= 1.9 * Math.min(x, y);
}

/** Geometry stays authoritative whenever bounded, stable pixel evidence is unavailable. */
export function groupOcrWithEnclosures(
	words: readonly Bubble[],
	pixels?: OcrPixels,
	useInclination = false
): Bubble[] {
	const baseline = useInclination ? analyzeOrientedMergeBubbles(words) : analyzeMergeBubbles(words);
	const fallback = () => baseline.map((g) => g.bubble);
	if (
		!pixels ||
		!canAnalyzeOcrPixels(pixels.width, pixels.height) ||
		pixels.data.length !== pixels.width * pixels.height * 4 ||
		words.length > 10000
	)
		return fallback();
	try {
		const reduced = raster(pixels);
		const groups = baseline.map((g) => ({
			words: g.sourceIndexes.map((i) => ({
				...words[i],
				shape: {
					...words[i].shape,
					vs: words[i].shape.vs.map((v) => ({ x: v.x * reduced.scaleX, y: v.y * reduced.scaleY }))
				}
			}))
		}));
		const evidence = artworkWordEnclosures(reduced.pixels, groups);
		const pieces: Piece[] = [];
		for (const [source, group] of baseline.entries()) {
			const labels = evidence[source];
			// Never guess ownership of a crossing/unknown word or move a positioned overlay.
			if (
				labels.some(
					(e, i) =>
						!e.key ||
						e.alternatives.some((k) => k !== e.key) ||
						words[group.sourceIndexes[i]].layout !== undefined
				)
			) {
				pieces.push({ key: null, indexes: [...group.sourceIndexes], sources: [source] });
				continue;
			}
			const byKey = new Map<string, number[]>();
			labels.forEach((e, i) => {
				const list = byKey.get(e.key!) ?? [];
				list.push(group.sourceIndexes[i]);
				byKey.set(e.key!, list);
			});
			for (const [key, indexes] of byKey) pieces.push({ key, indexes, sources: [source] });
		}
		let comparisons = 0;
		// A shared region alone is insufficient: fragments must be local and metadata-compatible.
		for (let i = 0; i < pieces.length; i++) {
			const part = pieces[i];
			if (!part.key) continue;
			for (let j = i + 1; j < pieces.length; j++) {
				if (++comparisons > 100000) return fallback();
				const next = pieces[j];
				if (
					next.key !== part.key ||
					![...part.indexes, ...next.indexes].every((index) =>
						compatible(words[part.indexes[0]], words[index])
					) ||
					!neighbors(part.indexes, next.indexes, words) ||
					!sizeCompatible(part.indexes, next.indexes, words)
				)
					continue;
				part.indexes.push(...next.indexes);
				part.sources.push(...next.sources);
				pieces.splice(j, 1);
				j = i;
			}
		}
		pieces.sort(
			(a, b) =>
				Math.min(...a.sources) - Math.min(...b.sources) ||
				box(words[a.indexes[0]].shape).top - box(words[b.indexes[0]].shape).top ||
				box(words[a.indexes[0]].shape).left - box(words[b.indexes[0]].shape).left
		);
		return pieces.map((p) => {
			const sources = [...new Set(p.sources)],
				original = baseline[sources[0]];
			if (sources.length === 1 && p.indexes.length === original.sourceIndexes.length)
				return original.bubble;
			return assembleEnclosedWords(p.indexes.toSorted((a, b) => a - b).map((i) => words[i])).bubble;
		});
	} catch {
		// Complexity limits or unsupported evidence must not prevent ordinary OCR merging.
		return fallback();
	}
}
