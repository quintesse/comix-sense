import { BblShapeType, type BblShape, type Bubble, type Vertex } from './types/Comic';

type Box = { l: number; t: number; r: number; b: number };
type SourceWord = { index: number; bubble: Bubble; box: Box; text: string };
/** Source references are zero-based indexes into the supplied bubbles, never inferred
 * from text/geometry. Candidate snapshots retain membership at decision time. */
export type MergeDecision = {
	id: number;
	stage:
		| 'row'
		| 'row-punctuation'
		| 'run'
		| 'gutter-pair'
		| 'gutter-boundary'
		| 'gutter-selection'
		| 'continuation'
		| 'continuation-selection'
		| 'fragment';
	phase: 'grouping' | 'assembly';
	candidates: number[][];
	measurements: Record<string, number | boolean>;
	limits: Record<string, number>;
	reasons: string[];
	decision: string;
	/** Selection policy, including stable traversal ties; not confidence. */
	tieBreak?: string;
};
export type MergeAnalysis = {
	groups: MergeGroup[];
	sources: { sourceIndex: number; box: Box; text: string; normalizedText: string }[];
	decisions: MergeDecision[];
};
type Trace = { events: MergeDecision[]; phase: MergeDecision['phase'] };
const indexes = (line: Line) => line.words.map((word) => word.index);
function record(trace: Trace | undefined, event: Omit<MergeDecision, 'id' | 'phase'>) {
	if (trace) trace.events.push({ id: trace.events.length, phase: trace.phase, ...event });
}
/** Keep measurement and gate names alongside the unchanged geometric policy. */
function rejected(checks: Record<string, boolean>): string[] {
	return Object.keys(checks).filter((key) => checks[key]);
}
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
	constructor(public words: SourceWord[]) {}
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
const compatible = (a: SourceWord, b: SourceWord) =>
	// Independently positioned inputs are never combined: retain each placement intact.
	a.bubble.layout === undefined &&
	b.bubble.layout === undefined &&
	a.bubble.lang === b.bubble.lang &&
	equal(a.bubble.style, b.bubble.style);
const punctuation = (text: string) => text.length > 0 && !/[\p{L}\p{Nd}]/u.test(text);
function rowEvidence(word: SourceWord, row: Line, trace?: Trace) {
	const h = Math.max(height(word.box), row.height);
	const d = Math.abs(cy(word.box) - row.center);
	const smallPunctuation =
		punctuation(word.text) &&
		height(word.box) <= row.height &&
		row.words.some((w) => {
			const overlap = Math.min(w.box.b, word.box.b) - Math.max(w.box.t, word.box.t);
			const gap = Math.max(w.box.l, word.box.l) - Math.min(w.box.r, word.box.r);
			// Compare the original endpoints, preserving floating-point behavior.
			const verticalTouch = Math.min(w.box.b, word.box.b) >= Math.max(w.box.t, word.box.t);
			const eligible = !punctuation(w.text) && verticalTouch && gap <= 0.35 * height(w.box);
			if (trace)
				record(trace, {
					stage: 'row-punctuation',
					candidates: [[word.index], [w.index]],
					measurements: { overlap, gap, verticalTouch, neighborPunctuation: punctuation(w.text) },
					limits: { maximumGap: 0.35 * height(w.box) },
					reasons: rejected({
						'punctuation-neighbor': punctuation(w.text),
						'no-vertical-touch': !verticalTouch,
						'horizontal-gap': !(gap <= 0.35 * height(w.box))
					}),
					decision: eligible ? 'punctuation-witness' : 'reject-punctuation-neighbor'
				});
			return eligible;
		});
	return {
		compatible: compatible(word, row.words[0]),
		smallPunctuation,
		height: height(word.box),
		rowHeight: row.height,
		h,
		distance: d
	};
}
function rows(input: SourceWord[], trace?: Trace): Line[] {
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
			const evidence = rowEvidence(word, row, trace);
			const { h, distance: d, smallPunctuation } = evidence;
			const eligible =
				evidence.compatible &&
				(smallPunctuation ||
					(Math.min(evidence.height, evidence.rowHeight) >= 0.55 * h && d <= 0.42 * h));
			if (trace)
				record(trace, {
					stage: 'row',
					candidates: [[word.index], indexes(row)],
					measurements: { ...evidence, incumbentDistance: distance },
					limits: {
						minimumHeight: 0.55 * h,
						maximumCenterDistance: 0.42 * h,
						punctuationReachHeightFactor: 0.35
					},
					reasons: rejected({
						incompatible: !evidence.compatible,
						height: !smallPunctuation && Math.min(evidence.height, evidence.rowHeight) < 0.55 * h,
						center: !smallPunctuation && d > 0.42 * h,
						'not-closer': eligible && !(d < distance)
					}),
					decision: eligible && d < distance ? 'replace-best-row' : 'reject-row',
					tieBreak: 'Strictly smaller center distance; first row in creation order wins ties.'
				});
			if (eligible && d < distance) {
				best = row;
				distance = d;
			}
		}
		if (trace)
			record(trace, {
				stage: 'row',
				candidates: [[word.index], ...(best ? [indexes(best)] : [])],
				measurements: {},
				limits: {},
				reasons: [],
				decision: best ? 'assign-row' : 'start-row'
			});
		if (best) best.words.push(word);
		else result.push(new Line([word]));
	}
	return result;
}
function runs(row: Line, trace?: Trace): Line[] {
	row.words.sort((a, b) => a.box.l - b.box.l || a.index - b.index);
	const result: Line[] = [];
	let current: Line | undefined;
	for (const word of row.words) {
		const gap = current ? word.box.l - current.box.r : undefined;
		const separate = !current || gap! > 0.65 * row.height;
		if (trace)
			record(trace, {
				stage: 'run',
				candidates: [...(current ? [indexes(current)] : []), [word.index]],
				measurements: gap === undefined ? {} : { gap, rowHeight: row.height },
				limits: { maximumGap: 0.65 * row.height },
				reasons: gap !== undefined && separate ? ['horizontal-gap'] : [],
				decision: separate ? 'start-run' : 'append-run'
			});
		if (separate) {
			current = new Line([]);
			result.push(current);
		}
		current!.words.push(word);
	}
	return result;
}
function gutterEvidence(line: Line, left: Line, right: Line, h: number, box: Box, trace?: Trace) {
	const a = left.box,
		b = right.box;
	const gap = b.l - a.r;
	const gapReasons = rejected({
		'gutter-too-narrow': gap < 0.9 * h,
		'gutter-too-wide': gap > 3 * h
	});
	// Keep the original cheap early gates cheap for production. Offline traces
	// additionally measure the other failed predicates for rejected pairs.
	if (!trace && gapReasons.length) return { measurements: { gap }, reasons: gapReasons };
	const measurements = {
		gap,
		rowAlignment: Math.abs(left.center - right.center),
		rowDistance: Math.abs(line.center - left.center),
		leftCenter: cx(a),
		rightCenter: cx(b),
		lineLeft: box.l,
		lineRight: box.r,
		height: h
	};
	const reasons = [
		...gapReasons,
		...rejected({
			'evidence-row-alignment': measurements.rowAlignment > 0.4 * h,
			'evidence-too-far': measurements.rowDistance > 1.65 * h,
			'evidence-too-close': measurements.rowDistance < 0.6 * h,
			'left-center-outside': cx(a) <= box.l,
			'right-center-outside': cx(b) >= box.r,
			'incompatible-left': !compatible(line.words[0], left.words[0]),
			'incompatible-right': !compatible(line.words[0], right.words[0])
		})
	];
	return { measurements, reasons };
}
function split(line: Line, all: Line[], trace?: Trace): Line[] {
	const cuts = new Set<number>(),
		h = line.height,
		box = line.box;
	for (const left of all)
		for (const right of all) {
			if (left === line || right === line || left === right) continue;
			const { measurements, reasons } = gutterEvidence(line, left, right, h, box, trace);
			if (trace)
				record(trace, {
					stage: 'gutter-pair',
					candidates: [indexes(line), indexes(left), indexes(right)],
					measurements,
					limits: {
						minimumGap: 0.9 * h,
						maximumGap: 3 * h,
						maximumRowAlignment: 0.4 * h,
						minimumRowDistance: 0.6 * h,
						maximumRowDistance: 1.65 * h
					},
					reasons,
					decision: reasons.length ? 'reject-evidence-pair' : 'search-boundaries'
				});
			if (reasons.length) continue;
			const a = left.box,
				b = right.box;
			const gutter = (a.r + b.l) / 2;
			let best = -1,
				score = -Infinity;
			for (let i = 1; i < line.words.length; i++) {
				const prev = line.words[i - 1].box,
					next = line.words[i].box;
				const x = (prev.r + next.l) / 2,
					gap = next.l - prev.r;
				const reasons = rejected({
					'left-search-limit': x < a.r - 1.5 * h,
					'right-search-limit': x > b.l + 1.5 * h,
					'left-evidence-center': x <= cx(a),
					'right-evidence-center': x >= cx(b),
					'word-overlap': gap < -0.25 * h
				});
				const value = reasons.length ? -Infinity : gap - 0.08 * Math.abs(x - gutter);
				if (trace)
					record(trace, {
						stage: 'gutter-boundary',
						candidates: [
							[line.words[i - 1].index],
							[line.words[i].index],
							indexes(left),
							indexes(right)
						],
						measurements: {
							x,
							gap,
							gutter,
							distance: Math.abs(x - gutter),
							score: value,
							incumbentScore: score,
							boundary: i
						},
						limits: {
							minimumX: a.r - 1.5 * h,
							maximumX: b.l + 1.5 * h,
							leftCenter: cx(a),
							rightCenter: cx(b),
							minimumGap: -0.25 * h,
							distancePenalty: 0.08
						},
						reasons: [
							...reasons,
							...(!reasons.length && !(value > score) ? ['not-higher-score'] : [])
						],
						decision: reasons.length
							? 'reject-boundary'
							: value > score
								? 'replace-best-boundary'
								: 'retain-best-boundary',
						tieBreak: 'Strictly greater score; first left-to-right boundary wins ties.'
					});
				if (reasons.length) continue;
				if (value > score) {
					score = value;
					best = i;
				}
			}
			if (trace)
				record(trace, {
					stage: 'gutter-selection',
					candidates: [
						indexes(line),
						indexes(left),
						indexes(right),
						...(best > 0 ? [[line.words[best - 1].index], [line.words[best].index]] : [])
					],
					measurements: { boundary: best, score },
					limits: {},
					reasons: best > 0 ? [] : ['no-eligible-boundary'],
					decision: best > 0 ? 'add-cut' : 'no-cut'
				});
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
/** Geometric evidence only; eligibility and the existing cost stay separate. */
function continuationEvidence(upper: Line, lower: Line) {
	const a = upper.box,
		b = lower.box,
		h = Math.min(upper.height, lower.height);
	const overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l),
		gap = b.t - a.b;
	const measurements = {
		height: h,
		maximumHeight: Math.max(upper.height, lower.height),
		centerSeparation: lower.center - upper.center,
		gap,
		overlap
	};
	const limits = {
		maximumHeight: 1.9 * h,
		minimumCenterSeparation: 0.65 * h,
		minimumGap: -0.5 * h,
		maximumGap: 0.65 * h,
		minimumOverlap: 0,
		maximumAlignment: 2,
		alignmentWeight: 0.2
	};
	const reasons = rejected({
		incompatible: !compatible(upper.words[0], lower.words[0]),
		'nonpositive-height': h <= 0,
		'height-ratio': measurements.maximumHeight > 1.9 * h,
		'center-separation': measurements.centerSeparation < 0.65 * h,
		'vertical-overlap': gap < -0.5 * h,
		'vertical-gap': gap > 0.65 * h,
		'no-horizontal-overlap': overlap <= 0
	});
	return { measurements, limits, reasons, a, b, h, gap };
}
function continuation(upper: Line, lower: Line, trace?: Trace) {
	const evidence = continuationEvidence(upper, lower);
	const { measurements, limits, reasons, a, b, h, gap } = evidence;
	// Preserve the original gate before evaluating normalized alignment/cost.
	let alignment: number | undefined;
	let cost = Infinity;
	if (!reasons.length) {
		alignment = Math.min(Math.abs(cx(a) - cx(b)), Math.abs(a.l - b.l), Math.abs(a.r - b.r)) / h;
		cost = alignment > 2 ? Infinity : Math.max(0, gap) / h + 0.2 * alignment;
		if (alignment > 2) reasons.push('alignment');
	}
	if (trace)
		record(trace, {
			stage: 'continuation',
			candidates: [indexes(upper), indexes(lower)],
			measurements: { ...measurements, ...(alignment === undefined ? {} : { alignment }), cost },
			limits,
			reasons,
			decision: Number.isFinite(cost) ? 'eligible-continuation' : 'reject-continuation'
		});
	return cost;
}
function fragmentEvidence(upper: Line, lower: Line, sibling: Line, siblingMutual: boolean) {
	const a = upper.box,
		b = lower.box,
		c = sibling.box,
		h = upper.height;
	const measurements = {
		siblingMutual: siblingMutual,
		centerDistance: Math.abs(lower.center - sibling.center),
		lowerLeft: b.l,
		lowerRight: b.r,
		siblingLeft: c.l,
		siblingRight: c.r,
		height: h
	};
	const limits = {
		maximumCenterDistance: 0.4 * h,
		minimumLeft: a.l - 0.5 * h,
		maximumRight: a.r + 0.5 * h
	};
	const reasons = rejected({
		'sibling-not-mutual': !measurements.siblingMutual,
		'center-distance': !(measurements.centerDistance <= 0.4 * h),
		'lower-left-overhang': !(b.l >= a.l - 0.5 * h),
		'lower-right-overhang': !(b.r <= a.r + 0.5 * h),
		'sibling-left-overhang': !(c.l >= a.l - 0.5 * h),
		'sibling-right-overhang': !(c.r <= a.r + 0.5 * h)
	});
	return { measurements, limits, reasons };
}
/** Flatten OCR formatting while keeping hyphenated line breaks joined. */
function unformatted(value: string): string {
	return value
		.replace(/-[^\S\r\n\u2028\u2029]*[\r\n\u2028\u2029]\s*/gu, '-')
		.replace(/\s+/gu, ' ')
		.trim();
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

export type MergeGroup = {
	bubble: Bubble;
	sourceIndexes: number[];
	/** Final reconstructed rows, including empty-text members; not provisional runs. */
	rows: { text: string; sourceIndexes: number[] }[];
};

/** Port of tools/bubblemerge.java, operating on a single page without mutating OCR. */
export function mergeBubbles(bubbles: readonly Bubble[]): Bubble[] {
	return analyzeMergeBubbles(bubbles).map((group) => group.bubble);
}

/** Groups are in output reading order. Diagnostics never enter serialized bubbles. */
export function analyzeMergeBubbles(bubbles: readonly Bubble[]): MergeGroup[] {
	return mergeSourceWords(sourceWords(bubbles));
}

/** Reconstruct printed rows and their outline for an independently established membership. */
export function assembleEnclosedWords(bubbles: readonly Bubble[]): MergeGroup {
	if (!bubbles.length) throw new Error('An enclosure needs at least one word.');
	return assembleGroup(rows(sourceWords(bubbles)));
}

/** Opt-in offline analysis. Candidate indexes refer to the supplied bubbles. */
export function inspectMergeBubbles(bubbles: readonly Bubble[]): MergeAnalysis {
	const words = sourceWords(bubbles);
	const trace: Trace = { events: [], phase: 'grouping' };
	const groups = mergeSourceWords(words, trace);
	return {
		groups,
		sources: words.map((word) => ({
			sourceIndex: word.index,
			box: { ...word.box },
			text: word.bubble.text ?? '',
			normalizedText: word.text
		})),
		decisions: trace.events
	};
}
function sourceWords(bubbles: readonly Bubble[]): SourceWord[] {
	return bubbles.map((bubble, index) => {
		const { type, vs } = bubble.shape;
		if (
			!((type === 'box' && vs.length === 2) || (type === 'poly' && vs.length >= 3)) ||
			!vs.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))
		)
			throw new Error('Expected box or polygon with valid vertices.');
		return {
			bubble,
			index,
			text: unformatted(bubble.text ?? ''),
			box: {
				l: Math.min(...vs.map((v) => v.x)),
				t: Math.min(...vs.map((v) => v.y)),
				r: Math.max(...vs.map((v) => v.x)),
				b: Math.max(...vs.map((v) => v.y))
			}
		};
	});
}
function mergeSourceWords(words: SourceWord[], trace?: Trace): MergeGroup[] {
	const initial = rows(words, trace).flatMap((row) => runs(row, trace));
	const lines = initial
		.flatMap((line) => split(line, initial, trace))
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
	const edges: { a: number; b: number; cost: number }[] = [];
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++) {
			const cost = continuation(lines[i], lines[j], trace);
			if (!Number.isFinite(cost)) continue;
			edges.push({ a: i, b: j, cost });
			if (cost < downCost[i]) {
				downCost[i] = cost;
				below[i] = j;
			}
			if (cost < upCost[j]) {
				upCost[j] = cost;
				above[j] = i;
			}
		}
	for (const { a, b, cost } of edges) {
		const mutual = below[a] === b && above[b] === a;
		if (trace)
			record(trace, {
				stage: 'continuation-selection',
				candidates: [
					indexes(lines[a]),
					indexes(lines[b]),
					indexes(lines[below[a]]),
					indexes(lines[above[b]])
				],
				measurements: {
					upper: a,
					lower: b,
					cost,
					selectedBelow: below[a],
					selectedAbove: above[b],
					downCost: downCost[a],
					upCost: upCost[b]
				},
				limits: {},
				reasons: rejected({
					'upper-prefers-other': below[a] !== b,
					'lower-prefers-other': above[b] !== a
				}),
				decision: mutual ? 'join-mutual' : 'not-mutual',
				tieBreak: 'Strictly smaller cost; first candidate in sorted-line pair traversal wins ties.'
			});
		if (mutual) parent[root(b)] = root(a);
	}
	for (let j = 0; j < n; j++) {
		const i = above[j];
		if (i < 0 || below[i] < 0 || below[i] === j) {
			if (trace)
				record(trace, {
					stage: 'fragment',
					candidates: [indexes(lines[j]), ...(i < 0 ? [] : [indexes(lines[i])])],
					measurements: { predecessor: i },
					limits: {},
					reasons: [i < 0 ? 'no-predecessor' : below[i] < 0 ? 'no-sibling' : 'already-selected'],
					decision: 'skip-fragment'
				});
			continue;
		}
		const upper = lines[i],
			lower = lines[j],
			sibling = lines[below[i]];
		const { measurements, limits, reasons } = fragmentEvidence(
			upper,
			lower,
			sibling,
			above[below[i]] === i
		);
		if (trace)
			record(trace, {
				stage: 'fragment',
				candidates: [indexes(upper), indexes(lower), indexes(sibling)],
				measurements,
				limits,
				reasons,
				decision: reasons.length ? 'reject-fragment' : 'join-fragment'
			});
		if (!reasons.length) parent[root(j)] = root(i);
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
	if (trace) trace.phase = 'assembly';
	return ordered.map((group) => assembleGroup(group, trace));
}

/** Metadata, final rows, formatting and outlines are downstream of grouping. */
function assembleGroup(group: Line[], trace?: Trace): MergeGroup {
	const members = group.flatMap((line) => line.words);
	const first = members.reduce((a, b) => (a.index < b.index ? a : b));
	const merged: Bubble = JSON.parse(JSON.stringify(first.bubble));
	merged.text = first.text;
	const textRows = rows(members, trace).sort((a, b) => a.center - b.center);
	for (const row of textRows) row.words.sort((a, b) => a.box.l - b.box.l);
	if (members.length > 1) {
		merged.text = unformatted(textRows.map(text).filter(Boolean).join('\n'));
		merged.shape = outline(group);
	}
	return {
		bubble: merged,
		sourceIndexes: members.map((word) => word.index),
		rows: textRows.map((row) => ({
			text: text(row),
			sourceIndexes: row.words.map((word) => word.index)
		}))
	};
}
