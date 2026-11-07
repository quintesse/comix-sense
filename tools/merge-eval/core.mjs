import { createHash } from 'node:crypto';
export const hash = (value) =>
	createHash('sha256')
		.update(JSON.stringify(canonical(value)))
		.digest('hex');
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical(value[key])])
		);
	return value;
}
const assert = (ok, message) => {
	if (!ok) throw new Error(message);
};
const id = (v) => typeof v === 'string' && v.length > 0;
export function validate(data) {
	assert(
		data?.schemaVersion === 1 && Array.isArray(data.pages) && data.pages.length,
		'Expected schemaVersion 1 and nonempty pages'
	);
	const pages = new Set();
	for (const page of data.pages) {
		assert(id(page.id) && !pages.has(page.id), 'Duplicate/invalid page ID');
		pages.add(page.id);
		assert(Array.isArray(page.words), 'Expected words');
		assert(page.notes === undefined || typeof page.notes === 'string', 'Invalid notes');
		assert(
			page.imageSize === undefined ||
				(Number.isFinite(page.imageSize.width) &&
					page.imageSize.width > 0 &&
					Number.isFinite(page.imageSize.height) &&
					page.imageSize.height > 0),
			'Invalid imageSize'
		);
		assert(
			page.image === undefined ||
				(id(page.image) &&
					(!/^[a-z][a-z\d+.-]*:/i.test(page.image) || /^[a-z]:[\\/]/i.test(page.image))),
			'Image must be a local path'
		);
		const words = new Map();
		for (const word of page.words) {
			assert(id(word.id) && !words.has(word.id), 'Duplicate/invalid word ID');
			words.set(word.id, word);
			assert(typeof word.text === 'string', 'Expected word text');
			for (const key of Object.keys(word))
				assert(
					['id', 'text', 'shape', 'lang', 'style', 'layout', 'extended', 'review'].includes(key),
					`Unknown word field ${key}`
				);
			assert(word.lang === undefined || typeof word.lang === 'string', 'Invalid language');
			assert(
				word.style === undefined ||
					(word.style &&
						!Array.isArray(word.style) &&
						typeof word.style === 'object' &&
						Object.values(word.style).every((v) => typeof v === 'string')),
				'Invalid style'
			);
			for (const shape of [word.shape, ...(word.layout === undefined ? [] : [word.layout])]) {
				assert(
					shape &&
						((shape.type === 'box' && shape.vs?.length === 2) ||
							(shape.type === 'poly' && shape.vs?.length >= 3)),
					'Invalid shape'
				);
				assert(
					shape.vs.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)),
					'Nonfinite geometry'
				);
				assert(
					Math.max(...shape.vs.map((v) => v.x)) > Math.min(...shape.vs.map((v) => v.x)) &&
						Math.max(...shape.vs.map((v) => v.y)) > Math.min(...shape.vs.map((v) => v.y)),
					'Degenerate geometry'
				);
			}
			assert(word.layout === undefined || word.layout.type === 'box', 'Layout must be a box');
			const r = word.review;
			if (r === undefined) continue;
			assert(r && typeof r === 'object' && !Array.isArray(r), 'Invalid review');
			assert(r.reason === undefined || typeof r.reason === 'string', 'Invalid review reason');
			assert(
				['reviewed', 'unreviewed', 'ambiguous', 'excluded'].includes(r.status),
				'Invalid review status'
			);
			if (r.status === 'reviewed')
				assert(
					id(r.bubble) && (r.line === undefined || id(r.line)),
					'Reviewed words need bubble IDs'
				);
			else assert(r.bubble === undefined && r.line === undefined, 'Nonreviewed word has labels');
		}
		const complete = page.completeBubbles ?? [];
		assert(
			Array.isArray(complete) && new Set(complete).size === complete.length,
			'Invalid completeBubbles'
		);
		for (const label of complete)
			assert(
				page.words.some((w) => w.review?.status === 'reviewed' && w.review.bubble === label),
				'Unknown complete bubble'
			);
		const edges = page.order ?? [];
		assert(Array.isArray(edges), 'Expected order relationships');
		const graph = new Map();
		const seen = new Set();
		for (const pair of edges) {
			assert(
				Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1],
				'Invalid order relationship'
			);
			assert(
				pair.every((key) => words.get(key)?.review?.status === 'reviewed'),
				'Order references must be reviewed word IDs'
			);
			assert(!seen.has(JSON.stringify(pair)), 'Duplicate order relationship');
			seen.add(JSON.stringify(pair));
			graph.set(pair[0], [...(graph.get(pair[0]) ?? []), pair[1]]);
		}
		const visit = (key, stack = new Set()) => {
			assert(!stack.has(key), 'Contradictory cyclic order');
			for (const next of graph.get(key) ?? []) visit(next, new Set([...stack, key]));
		};
		for (const key of graph.keys()) visit(key);
	}
	return data;
}
export function identities(page) {
	return {
		inputHash: hash(page.words.map(({ review, ...word }) => word)),
		labelHash: hash({
			reviews: page.words.map((w) => [w.id, w.review ?? { status: 'unreviewed' }]),
			completeBubbles: page.completeBubbles ?? [],
			order: page.order ?? []
		})
	};
}
export function evaluate(page, groups, errors = [], unscored = []) {
	const locations = new Map();
	groups.forEach((group, g) => {
		assert(Array.isArray(group.members) && group.members.length, 'Empty predicted group');
		assert(
			hash([...group.members].sort()) === hash(group.rows.flatMap((r) => r.members).sort()),
			'Rows must partition group members'
		);
		group.rows.forEach((row, l) =>
			row.members.forEach((key, w) => {
				assert(!locations.has(key), 'Duplicate predicted member');
				locations.set(key, [g, l, w]);
			})
		);
	});
	assert(
		locations.size === page.words.length && page.words.every((w) => locations.has(w.id)),
		'Predictions must partition every source word'
	);
	const reviewed = page.words.filter((w) => w.review?.status === 'reviewed');
	const result = {
		words: page.words.length,
		reviewed: reviewed.length,
		unreviewed: 0,
		ambiguous: 0,
		excluded: 0,
		lineReviewed: reviewed.filter((w) => w.review.line !== undefined).length,
		sameBubblePairs: 0,
		differentBubblePairs: 0,
		falseJoins: 0,
		falseSplits: 0,
		linePairs: 0,
		lineErrors: 0,
		orderPairs: 0,
		orderErrors: 0,
		orderIncomparable: 0,
		completeBubbles: (page.completeBubbles ?? []).length,
		exactBubbleEligible: 0,
		exactBubbleUnscored: 0,
		exactBubbles: 0
	};
	for (const word of page.words)
		if (word.review?.status !== 'reviewed') result[word.review?.status ?? 'unreviewed']++;
	for (let i = 0; i < reviewed.length; i++)
		for (let j = i + 1; j < reviewed.length; j++) {
			const a = reviewed[i],
				b = reviewed[j],
				x = locations.get(a.id),
				y = locations.get(b.id);
			const same = a.review.bubble === b.review.bubble;
			result[same ? 'sameBubblePairs' : 'differentBubblePairs']++;
			if (same && x[0] !== y[0]) {
				result.falseSplits++;
				errors.push(JSON.stringify(['falseSplit', ...[a.id, b.id].sort()]));
			}
			if (!same && x[0] === y[0]) {
				result.falseJoins++;
				errors.push(JSON.stringify(['falseJoin', ...[a.id, b.id].sort()]));
			}
			if (same && a.review.line !== undefined && b.review.line !== undefined) {
				result.linePairs++;
				if ((a.review.line === b.review.line) !== (x[0] === y[0] && x[1] === y[1])) {
					result.lineErrors++;
					errors.push(JSON.stringify(['line', ...[a.id, b.id].sort()]));
				}
			}
		}
	for (const label of page.completeBubbles ?? []) {
		const expected = reviewed
			.filter((w) => w.review.bubble === label)
			.map((w) => w.id)
			.sort();
		const errorKey = JSON.stringify(['inexactBubble', ...expected]);
		// Unknown/excluded material is never an implicit negative, even for exactness.
		const touched = groups.filter((g) => g.members.some((id) => expected.includes(id)));
		if (touched.some((g) => g.members.some((id) => !reviewed.some((w) => w.id === id)))) {
			result.exactBubbleUnscored++;
			unscored.push(errorKey);
			continue;
		}
		result.exactBubbleEligible++;
		if (groups.some((g) => hash([...g.members].sort()) === hash(expected))) result.exactBubbles++;
		else errors.push(errorKey);
	}
	for (const [a, b] of page.order ?? []) {
		const x = locations.get(a),
			y = locations.get(b);
		const wa = page.words.find((w) => w.id === a),
			wb = page.words.find((w) => w.id === b);
		// Cross-bubble relations require separate predicted groups; internal relations require a shared group.
		if ((wa.review.bubble === wb.review.bubble) !== (x[0] === y[0])) {
			result.orderIncomparable++;
			errors.push(JSON.stringify(['orderIncomparable', a, b]));
			continue;
		}
		result.orderPairs++;
		const first = x.findIndex((value, i) => value !== y[i]);
		if (first < 0 || x[first] >= y[first]) {
			result.orderErrors++;
			errors.push(JSON.stringify(['order', a, b]));
		}
	}
	return result;
}
export function compare(current, baseline, { allowAlgorithmChange = false } = {}) {
	assert(
		baseline?.schemaVersion === 1 &&
			(baseline.algorithm === current.algorithm || allowAlgorithmChange) &&
			baseline.metricVersion === current.metricVersion,
		'Incompatible baseline schema/algorithm/metrics'
	);
	assert(
		Array.isArray(baseline.pages) &&
			baseline.pages.length === current.pages.length &&
			new Set(baseline.pages.map((p) => p.id)).size === baseline.pages.length,
		'Incompatible baseline pages'
	);
	return current.pages.map((page) => {
		const old = baseline.pages.find((p) => p.id === page.id);
		assert(
			old && old.inputHash === page.inputHash && old.labelHash === page.labelHash,
			`Incompatible inputs/labels: ${page.id}`
		);
		const previousErrors = [],
			currentErrors = [],
			previousUnscored = [],
			currentUnscored = [];
		const before = evaluate(page.input, old.groups, previousErrors, previousUnscored),
			after = evaluate(page.input, page.groups, currentErrors, currentUnscored);
		const changes = {};
		for (const key of [
			'falseJoins',
			'falseSplits',
			'lineErrors',
			'orderErrors',
			'orderIncomparable',
			'exactBubbleEligible',
			'exactBubbleUnscored',
			'exactBubbles'
		])
			changes[key] = after[key] - before[key];
		return {
			id: page.id,
			behaviorChanged: hash(old.groups) !== hash(page.groups),
			changes,
			improvements: previousErrors
				.filter((e) => !currentErrors.includes(e) && !currentUnscored.includes(e))
				.map((e) => JSON.parse(e)),
			regressions: currentErrors
				.filter((e) => !previousErrors.includes(e) && !previousUnscored.includes(e))
				.map((e) => JSON.parse(e)),
			previous: old.groups
		};
	});
}
