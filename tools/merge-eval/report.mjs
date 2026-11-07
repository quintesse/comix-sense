import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const escape = (value) =>
	String(value).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);
export async function html(report, datasetDirectory) {
	let body = '';
	for (const [pageIndex, page] of report.pages.entries()) {
		let image = '';
		if (page.input.image) {
			const file = path.resolve(datasetDirectory, page.input.image);
			const mime = {
				'.png': 'image/png',
				'.jpg': 'image/jpeg',
				'.jpeg': 'image/jpeg',
				'.webp': 'image/webp'
			}[path.extname(file).toLowerCase()];
			if (!mime) throw new Error('Review images must be PNG, JPEG or WebP');
			image = `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
		}
		const all = page.input.words.flatMap((w) => w.shape.vs);
		const minX = Math.min(0, ...all.map((v) => v.x)),
			minY = Math.min(0, ...all.map((v) => v.y));
		const width = Math.max(page.input.imageSize?.width ?? 100, ...all.map((v) => v.x)) - minX + 20,
			height = Math.max(page.input.imageSize?.height ?? 100, ...all.map((v) => v.y)) - minY + 20;
		function view(title, groups) {
			const colors = new Map();
			groups.forEach((g, i) =>
				g.members.forEach((id) => colors.set(id, `hsl(${(i * 137.5) % 360} 80% 40%)`))
			);
			return `<section><h3>${escape(title)}</h3><svg viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-label="${escape(title)}">${image ? `<image href="${image}" x="0" y="0" width="${page.input.imageSize?.width ?? width - 20}" height="${page.input.imageSize?.height ?? height - 20}"/>` : ''}${page.input.words
				.map((w) => {
					const vs =
						w.shape.type === 'box'
							? [
									w.shape.vs[0],
									{ x: w.shape.vs[1].x, y: w.shape.vs[0].y },
									w.shape.vs[1],
									{ x: w.shape.vs[0].x, y: w.shape.vs[1].y }
								]
							: w.shape.vs;
					return `<g><title>${escape(`${w.id}: ${w.text} (${w.review?.status ?? 'unreviewed'})`)}</title><polygon points="${vs.map((v) => `${v.x},${v.y}`).join(' ')}" fill="none" stroke="${colors.get(w.id) ?? '#888'}" stroke-width="2"/><text x="${Math.min(...vs.map((v) => v.x))}" y="${Math.min(...vs.map((v) => v.y)) - 2}" font-size="9" fill="${colors.get(w.id) ?? '#666'}">${escape(w.id)}</text></g>`;
				})
				.join(
					''
				)}</svg><ol>${groups.map((g) => `<li>${escape(g.members.join(', '))}${g.rows ? `<ul>${g.rows.map((r) => `<li>${escape(r.members.join(', '))}: ${escape(r.text ?? '')}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol></section>`;
		}
		const expected = new Map();
		for (const w of page.input.words)
			if (w.review?.status === 'reviewed') {
				const list = expected.get(w.review.bubble) ?? [];
				list.push(w.id);
				expected.set(w.review.bubble, list);
			}
		const sourceAnchor = (id) =>
			`source-${pageIndex}-${page.input.words.findIndex((word) => word.id === id)}`;
		const sourceTable = `<details><summary>Source words and annotations</summary><table><thead><tr><th>Source ID / index</th><th>Original record</th></tr></thead><tbody>${page.input.words.map((word, i) => `<tr id="${sourceAnchor(word.id)}"><td>${escape(word.id)} / ${i}</td><td><pre>${escape(JSON.stringify(Object.fromEntries(Object.entries(word).filter(([key]) => key !== 'extended')), null, 2))}</pre></td></tr>`).join('')}</tbody></table></details>`;
		const previous = report.comparison?.find((p) => p.id === page.id);
		body += `<article><h2>${escape(page.id)}</h2><pre>${escape(
			JSON.stringify(
				{
					metrics: page.metrics,
					runtimeMs: page.runtimeMs,
					differences: previous
						? {
								behaviorChanged: previous.behaviorChanged,
								changes: previous.changes,
								improvements: previous.improvements.length,
								regressions: previous.regressions.length
							}
						: undefined
				},
				null,
				2
			)
		)}</pre><p>${escape(page.input.notes ?? '')}</p><div class="views">${view(
			'Expected reviewed groups',
			[...expected.values()].map((members) => ({ members }))
		)}${view('Actual groups and final rows', page.groups)}${previous ? view('Previous baseline', previous.previous) : ''}</div><details><summary>Reviewed relationship errors and comparison details</summary><pre>${escape(JSON.stringify({ errors: page.errors, unscored: page.unscored, improvements: previous?.improvements, regressions: previous?.regressions }, null, 2))}</pre></details>${sourceTable}</article>`;
	}
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Local merge evaluation</title><style>body{font:15px system-ui;margin:24px;background:#fafafa;color:#222}article{border-top:2px solid #888;margin-top:24px}.views{display:flex;align-items:flex-start;gap:16px}.views section{flex:1;min-width:0}svg{width:100%;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{overflow-wrap:anywhere}image{opacity:.75}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;text-align:left;vertical-align:top;padding:6px}details{margin:12px 0}tr:target{background:#fff3bb}</style><h1>Local merge evaluation</h1><p>Colors indicate membership; gray words have no reviewed group. IDs identify original inputs. Rows below each actual view are final reconstructed text rows. Baselines record behavior, not ground truth.</p><pre>${escape(JSON.stringify({ comparisonError: report.comparisonError, provenance: report.provenance, aggregate: report.aggregate }, null, 2))}</pre>${body}</html>`;
}
