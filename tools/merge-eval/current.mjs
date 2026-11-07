import { analyzeMergeBubbles } from '../../src/lib/mergeBubbles.ts';
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
