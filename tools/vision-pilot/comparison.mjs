import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const escape = (s) =>
	String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);
const intervalDifference = (intervals, other) =>
	intervals.flatMap(([left, right]) => {
		let pieces = [[left, right]];
		for (const [a, b] of other)
			pieces = pieces.flatMap(([l, r]) =>
				b <= l || a >= r
					? [[l, r]]
					: [
							[l, Math.min(r, a)],
							[Math.max(l, b), r]
						].filter(([x, y]) => x < y)
			);
		return pieces;
	});

/** Exact axis-aligned union, retaining only its outer edges for a clear overlay. */
export function rectangleUnion(boxes) {
	const rectangles = boxes.filter(
		(b) =>
			[b.left, b.right, b.top, b.bottom].every(Number.isFinite) &&
			b.left < b.right &&
			b.top < b.bottom
	);
	const ys = [...new Set(rectangles.flatMap((b) => [b.top, b.bottom]))].sort((a, b) => a - b);
	const slabs = ys.slice(0, -1).map((top, i) => {
		const bottom = ys[i + 1],
			intervals = rectangles
				.filter((b) => b.top <= top && b.bottom >= bottom)
				.map((b) => [b.left, b.right])
				.sort((a, b) => a[0] - b[0]);
		const merged = [];
		for (const [l, r] of intervals) {
			const last = merged.at(-1);
			if (last && l <= last[1]) last[1] = Math.max(last[1], r);
			else merged.push([l, r]);
		}
		return { top, bottom, intervals: merged };
	});
	let fill = '',
		outline = '';
	for (const [i, slab] of slabs.entries()) {
		for (const [l, r] of slab.intervals) {
			fill += `M${l},${slab.top}H${r}V${slab.bottom}H${l}Z`;
			outline += `M${l},${slab.top}V${slab.bottom}M${r},${slab.top}V${slab.bottom}`;
		}
		for (const [l, r] of intervalDifference(slab.intervals, slabs[i - 1]?.intervals ?? []))
			outline += `M${l},${slab.top}H${r}`;
		for (const [l, r] of intervalDifference(slab.intervals, slabs[i + 1]?.intervals ?? []))
			outline += `M${l},${slab.bottom}H${r}`;
	}
	return { fill, outline };
}

export function comparisonHtml({
	image,
	renderedImage,
	imageSize,
	source,
	target,
	spaces = [],
	showBounds = false
}) {
	const language = new Intl.DisplayNames(['en'], { type: 'language' });
	const display = (code) => {
		try {
			return escape(language.of(code));
		} catch {
			return 'Page';
		}
	};
	const overlays = spaces
		.map((p) => {
			const union = rectangleUnion(p.candidates.map((b) => b.usable));
			const vs = p.selected?.vs;
			const selected =
				vs?.length === 2
					? `<rect class="selected-layout" x="${vs[0].x}" y="${vs[0].y}" width="${vs[1].x - vs[0].x}" height="${vs[1].y - vs[0].y}"><title>Selected text layout, passage ${p.passage}</title></rect>`
					: '';
			return `<g data-passage="${p.passage}"><g class="fit-space"><title>Available fitting space, passage ${p.passage}; union of ${p.candidates.length} tested rectangles</title><path class="space-fill" d="${union.fill}"/><path class="space-outline" d="${union.outline}"/></g>${selected}</g>`;
		})
		.join('');
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Original and rendered page</title><style>
body{margin:0;font:16px system-ui;background:#eee;color:#17202b}header{padding:.5rem;background:#fff;position:sticky;top:0;z-index:2;border-bottom:1px solid #aaa}label{display:inline-block;margin:.3rem .8rem .3rem 0}input{accent-color:#124c96}main{display:grid;grid-template-columns:1fr 1fr;gap:4px}figure{margin:0;min-width:0}figcaption{padding:.4rem;font-weight:600}.page{position:relative}img{display:block;width:100%;height:auto}.bounds{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.fit-space,.selected-layout{display:none}.space-fill{fill:#2476db;fill-opacity:.13}.space-outline{fill:none;stroke:#0055b8;stroke-width:1.5;vector-effect:non-scaling-stroke}.selected-layout{fill:none;stroke:#127238;stroke-width:2;stroke-dasharray:6 3;vector-effect:non-scaling-stroke}body:has(#available-space:checked) .fit-space{display:block}body:has(#selected-layout:checked) .selected-layout{display:block}body:has(#original-size:checked) main{width:max(100%,${imageSize.width * 2 + 4}px)}#legend{font-size:14px;margin:.3rem 0}.available-key{color:#0055b8}.selected-key{color:#127238}
</style></head><body><header><label><input id="available-space" type="checkbox" aria-describedby="legend"${showBounds ? ' checked' : ''}> Show available fitting space</label><label><input id="selected-layout" type="checkbox" aria-describedby="legend"${showBounds ? ' checked' : ''}> Show selected text layouts</label><label><input id="original-size" type="checkbox"> Original size</label><p id="legend"><span class="available-key">Blue fill and solid outline: union of usable rectangles tested by the fitter, including OCR fallback.</span> <span class="selected-key">Green dashed outline: selected text layout.</span> These are fitting areas, not balloon boundaries. Overlays scale with both pages.</p></header><main><figure><figcaption>${display(source)} · Original</figcaption><div class="page"><img alt="Original comic page" src="${image}"><svg class="bounds" viewBox="0 0 ${imageSize.width} ${imageSize.height}" aria-label="Available fitting space and selected layouts on original">${overlays}</svg></div></figure><figure><figcaption>${display(target)} · ${source === target ? 'Rendered page' : 'Translation'}</figcaption><div class="page"><img alt="Rendered comic page" src="${renderedImage}"><svg class="bounds" viewBox="0 0 ${imageSize.width} ${imageSize.height}" aria-label="Available fitting space and selected text layouts">${overlays}</svg></div></figure></main></body></html>`;
}

/** Update presentation only. Reads saved geometry; never reruns detection or lettering. */
export function refreshComparison(output, name = 'source', showBounds = true) {
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid saved render name');
	const html = readFileSync(resolve(output, name + '.html'), 'utf8');
	const match = html.match(/window\.pilot=(.*?)<\/script>/s);
	if (!match) throw new Error('Saved render props unavailable');
	const props = JSON.parse(match[1]);
	const spaceFile = resolve(output, name + '.fitter-space.json');
	const spaces = JSON.parse(readFileSync(spaceFile, 'utf8'));
	const image = `data:image/png;base64,${readFileSync(resolve(output, name + '.review.png')).toString('base64')}`;
	const file = resolve(output, 'comparison.html');
	writeFileSync(
		file,
		comparisonHtml({
			image: props.image,
			renderedImage: image,
			imageSize: props.imageSize,
			source: props.bubbles[0]?.lang ?? 'und',
			target: props.bubbles[0]?.lang ?? 'und',
			spaces,
			showBounds
		})
	);
	return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length !== 3)
		throw new Error('Usage: node tools/vision-pilot/comparison.mjs SAVED_SOURCE_ATTEMPT_DIRECTORY');
	console.log(refreshComparison(resolve(process.argv[2])));
}
