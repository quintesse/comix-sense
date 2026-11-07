import { analyzeMergeBubbles, inspectMergeBubbles } from '../../src/lib/mergeBubbles.ts';
// Extended provider data and labels never enter the merger.
export const algorithm = 'app-geometric-v1';
export function predict(page) {
	return analyzeMergeBubbles(inputs(page)).map((group) => outputGroup(page, group));
}
export function inputs(page) {
	return page.words.map(({ text, shape, lang, style, layout }) => ({
		text,
		shape,
		lang,
		style,
		layout
	}));
}
function outputGroup(page, group) {
	return {
		bubble: group.bubble,
		members: group.sourceIndexes.map((i) => page.words[i].id),
		rows: group.rows.map((row) => ({
			text: row.text,
			members: row.sourceIndexes.map((i) => page.words[i].id)
		}))
	};
}
export function inspect(page) {
	return describeAnalysis(page, inspectMergeBubbles(inputs(page)));
}
export function describeAnalysis(page, analysis) {
	const candidates = [];
	const references = new Map();
	const reference = (indexes) => {
		const key = indexes.join(',');
		if (!references.has(key)) {
			const id = `c${candidates.length}`;
			references.set(key, id);
			candidates.push({ id, members: indexes.map((i) => page.words[i].id) });
		}
		return references.get(key);
	};
	return {
		groups: analysis.groups.map((group) => outputGroup(page, group)),
		diagnostics: {
			schemaVersion: 1,
			sources: analysis.sources.map(({ sourceIndex, ...source }) => ({
				id: page.words[sourceIndex].id,
				sourceIndex,
				...source
			})),
			candidates,
			decisions: analysis.decisions.map(({ candidates, ...event }) => ({
				...event,
				// JSON must retain rejected infinite costs rather than silently turning them into null.
				measurements: Object.fromEntries(
					Object.entries(event.measurements).map(([key, value]) => [
						key,
						typeof value === 'number' && !Number.isFinite(value) ? String(value) : value
					])
				),
				candidates: candidates.map(reference)
			}))
		}
	};
}
