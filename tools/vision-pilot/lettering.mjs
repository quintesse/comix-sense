// Find a text rectangle inside the mask. Between consecutive vertex heights the
// left and right boundaries are linear, so both ends of each strip constrain it.
export function letteringBoxes(shape) {
	const points = shape.vs;
	const xs = points.map((p) => p.x),
		ys = points.map((p) => p.y);
	const top = Math.min(...ys),
		bottom = Math.max(...ys);
	const left = Math.min(...xs),
		right = Math.max(...xs);
	if (shape.type === 'box') return [{ left, right, top, bottom }];
	const levels = [
		...new Set([...ys, ...Array.from({ length: 17 }, (_, i) => top + ((bottom - top) * i) / 16)])
	].sort((a, b) => a - b);
	function intervalsAt(mid, y) {
		const crossings = [];
		for (let i = 0; i < points.length; i++) {
			const a = points[i],
				b = points[(i + 1) % points.length];
			if (a.y > mid !== b.y > mid) {
				const slope = (b.x - a.x) / (b.y - a.y);
				crossings.push({ mid: a.x + (mid - a.y) * slope, x: a.x + (y - a.y) * slope });
			}
		}
		crossings.sort((a, b) => a.mid - b.mid);
		return crossings.filter((_, i) => i % 2 === 0).map((p, i) => [p.x, crossings[2 * i + 1].x]);
	}
	function intersect(a, b) {
		return a.flatMap(([l, r]) =>
			b.map(([x, y]) => [Math.max(l, x), Math.min(r, y)]).filter(([x, y]) => x < y)
		);
	}
	const strips = levels.slice(1).map((y, i) => {
		const mid = (y + levels[i]) / 2;
		return intersect(intervalsAt(mid, levels[i]), intervalsAt(mid, y));
	});
	const candidates = [];
	for (let i = 0; i < strips.length; i++) {
		let intervals = [[left, right]];
		for (let j = i; j < strips.length && intervals.length; j++) {
			intervals = intersect(intervals, strips[j]);
			for (const [l, r] of intervals) {
				candidates.push({ left: l, right: r, top: levels[i], bottom: levels[j + 1] });
			}
		}
	}
	if (!candidates.length) throw new Error('Mask has no positive text rectangle');
	// A wider and taller candidate can fit every line arrangement a smaller one can.
	const width = (b) => b.right - b.left;
	const height = (b) => b.bottom - b.top;
	candidates.sort((a, b) => width(b) - width(a) || height(b) - height(a));
	let tallest = 0;
	return candidates
		.filter((b) => {
			if (height(b) <= tallest) return false;
			tallest = height(b);
			return true;
		})
		.sort((a, b) => width(b) * height(b) - width(a) * height(a));
}

/** The exact candidates sent to fitting; an interior is already inset. */
export function fittingCandidates(bubble, interiors = []) {
	return [...(interiors ?? []), ...letteringBoxes(bubble.layout ?? bubble.shape)];
}

export function fittingSpace(candidates, bubbles) {
	return candidates.map((boxes, i) => ({
		passage: i + 1,
		candidates: boxes.map((box) => {
			const padding = box.inset
				? 0
				: Math.min(2, (box.right - box.left) / 12, (box.bottom - box.top) / 12);
			const clearance = box.inset ? 0 : 2;
			return {
				...box,
				kind: box.inset ? 'artwork interior' : 'OCR fallback',
				usable: {
					left: box.left + padding,
					right: box.right - padding,
					top: box.top + padding + clearance / 2,
					bottom: box.bottom - padding - clearance / 2
				}
			};
		}),
		selected: bubbles[i].layout
	}));
}
