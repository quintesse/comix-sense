// Offline evidence viewer: deliberately does not import dispatch, validators or renderers.
import { readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sourceEvidence } from './source-evidence.mjs';
import { privateOutput } from './private-output.mjs';

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const escape = (s) =>
	String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
	);

export function inspectMembership(request, response) {
	const size = request?.document?.imageSize;
	if (
		!Number.isSafeInteger(size?.width) ||
		!Number.isSafeInteger(size?.height) ||
		size.width <= 0 ||
		size.height <= 0
	)
		throw new Error('Diagnostic request has invalid image dimensions');
	const words = request.document.words.map(([id, text, type, vs]) => ({
		id,
		text,
		region: { type, vs: vs.map(([x, y]) => ({ x, y })) },
		occurrences: []
	}));
	const byId = new Map(words.map((w) => [w.id, w]));
	const unknown = [];
	const record = (id, occurrence) => {
		if (byId.has(id)) byId.get(id).occurrences.push(occurrence);
		else unknown.push({ id, ...occurrence });
	};
	const passages = response.value.passages.map((p, index) => ({
		number: index + 1,
		tokens: p.tokens.map((t, i) => {
			const id = typeof t === 'string' ? t : t.id;
			const w = byId.get(id);
			const token = {
				id: id ?? null,
				order: i + 1,
				text: typeof t === 'string' ? (w?.text ?? '[unknown ID]') : t.text,
				original: w?.text ?? null,
				region: w?.region ?? t.region ?? null,
				kind: typeof t === 'string' ? 'OCR' : id ? 'correction' : 'added region'
			};
			if (id) record(id, { passage: index + 1, order: i + 1, text: token.text });
			return token;
		})
	}));
	response.value.exclusions.forEach((e, i) => record(e.id, { exclusion: i + 1, reason: e.reason }));
	const missing = words.filter((w) => !w.occurrences.length).map((w) => w.id);
	const duplicates = words.filter((w) => w.occurrences.length > 1).map((w) => w.id);
	const conflicts = words
		.filter((w) => w.occurrences.some((o) => o.passage) && w.occurrences.some((o) => o.exclusion))
		.map((w) => w.id);
	return {
		imageSize: request.document.imageSize,
		passages,
		exclusions: response.value.exclusions,
		words,
		coverage: {
			supplied: words.length,
			accounted: words.length - missing.length,
			occurrences: words.reduce((n, w) => n + w.occurrences.length, 0),
			missing,
			duplicates,
			conflicts,
			unknown,
			exactlyOnce: !missing.length && !duplicates.length && !unknown.length
		}
	};
}

export function diagnosticHtml(model, imageData, evidence) {
	const e = escape;
	const color = (n) => `hsl(${(n * 137.508) % 360} 75% 36%)`;
	const points = (region) => {
		if (!region?.vs?.length) return '';
		const v = region.vs;
		return (
			region.type === 'box' && v.length === 2
				? [v[0], { x: v[1].x, y: v[0].y }, v[1], { x: v[0].x, y: v[1].y }]
				: v
		)
			.map((p) => e(`${p.x},${p.y}`))
			.join(' ');
	};
	const mark = (t, p, excluded = false) => {
		if (!t.region?.vs?.length) return '';
		const x = Math.min(...t.region.vs.map((v) => v.x)),
			y = Math.min(...t.region.vs.map((v) => v.y));
		const conflict = model.coverage.conflicts.includes(t.id);
		return `<g class="mark ${excluded ? 'excluded' : ''}" data-p="${p}" data-id="${e(t.id)}" tabindex="0"><title>${e(t.id)} • ${excluded ? 'Excluded' : `P${p} token ${t.order}`} • ${e(t.text)}${conflict ? ' • USED AND EXCLUDED' : ''}</title><polygon points="${points(t.region)}" fill="${excluded ? 'none' : color(p)}" fill-opacity=".13" stroke="${conflict ? '#d00000' : excluded ? '#555' : color(p)}" stroke-width="${conflict ? 5 : 2}" ${excluded ? 'stroke-dasharray="7 4"' : ''}/>${!excluded ? `<text x="${x}" y="${Math.max(12, y - 3)}" fill="${color(p)}">${p}.${t.order}${conflict ? ' !' : ''}</text>` : ''}</g>`;
	};
	const overlays =
		model.passages.map((p) => p.tokens.map((t) => mark(t, p.number)).join('')).join('') +
		model.words
			.filter((w) => w.occurrences.some((o) => o.exclusion) || !w.occurrences.length)
			.map((w) => mark(w, 0, true))
			.join('');
	const c = model.coverage;
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'"><title>Source grouping — offline evidence diagnostic</title>
<style>body{font:15px system-ui;margin:20px;color:#17202b;background:#f2f4f7}h1{font-size:24px}.warning{background:#ffe4e4;border:2px solid #a90000;padding:12px}button,select{font:inherit;padding:6px}header{position:sticky;top:0;background:#f2f4f7;z-index:2;padding-bottom:8px}.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;overflow:auto}.page{position:relative}.page img{width:100%;display:block}.page svg{position:absolute;inset:0;width:100%;height:100%}svg text{font:bold 14px system-ui;paint-order:stroke;stroke:white;stroke-width:3px;pointer-events:none}.mark{cursor:pointer}.mark.dim{opacity:.06}.mark.selected polygon{stroke:#e00000;stroke-width:7}.mark:focus polygon{stroke:#000;stroke-width:6}#detail{padding:12px;background:#fff;white-space:pre-wrap;border:1px solid #888;min-height:40px;max-height:180px;overflow:auto}.passages{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:12px}article{background:white;padding:12px;border-top:5px solid var(--color)}.token{display:inline-block;margin:3px;text-align:left;background:white;border:1px solid #bbb;border-radius:3px}.token small{display:block;color:#555}.conflict{background:#ffe4e4;color:#a00000;font-weight:bold}table{border-collapse:collapse;width:100%;background:white}td,th{border:1px solid #ccc;text-align:left;padding:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}figure{margin:0}figcaption{font-weight:bold;padding:8px}body.zoom .compare{grid-template-columns:${model.imageSize.width}px ${model.imageSize.width}px}</style>
<h1>Source grouping — offline evidence diagnostic</h1><p>Raw response projection, not an accepted grouping or an export. Outlines show OCR word regions and explicit added regions, not inferred balloon boundaries. Numbers are passage.token reading order.</p>
<p class="warning"><b>Saved result status: ${e(evidence.savedStatus ?? 'unknown')}; structural validation: ${e(evidence.savedStructuralValidation ?? 'unknown')}.</b> ${e(evidence.savedError)}<br>${c.accounted}/${c.supplied} OCR IDs accounted for; ${c.occurrences} known-ID occurrences. Duplicate IDs: ${e(c.duplicates.join(', ') || 'none')}. Used AND excluded: ${e(c.conflicts.join(', ') || 'none')}. Coverage is independent of balloon membership and is not structural approval.</p>
<header><label>Passage <select id="passage"><option value="all">All passages</option>${model.passages.map((p) => `<option value="${p.number}">Passage ${p.number}</option>`).join('')}<option value="0">Excluded / unassigned</option></select></label> <button id="zoom">Toggle original-pixel size</button><p id="detail">Select a passage, word outline, or token below. Red outline / ! = used and excluded; dashed outline = excluded or unassigned. Hover for ID and order.</p></header>
<div class="compare"><figure><figcaption>Original artwork — unchanged</figcaption><div class="page"><img src="${e(imageData)}" alt="Original page"></div></figure><figure><figcaption>Raw passages — numbered word membership</figcaption><div class="page"><img src="${e(imageData)}" alt="Original with diagnostic overlays"><svg viewBox="0 0 ${e(model.imageSize.width)} ${e(model.imageSize.height)}" aria-label="Passage word overlays">${overlays}</svg></div></figure></div>
<h2>Passages in returned order</h2><div class="passages">${model.passages.map((p) => `<article style="--color:${color(p.number)}"><h3>Passage ${p.number}</h3><p>${e(p.tokens.map((t) => t.text).join(' '))}</p>${p.tokens.map((t) => `<button class="token ${c.conflicts.includes(t.id) ? 'conflict' : ''}" data-p="${p.number}" data-order="${t.order}" data-id="${e(t.id)}">${p.number}.${t.order} ${e(t.text)}<small>${e(t.id ?? 'no OCR ID')} • ${e(t.kind)}${c.conflicts.includes(t.id) ? ' • USED AND EXCLUDED' : ''}</small></button>`).join('')}</article>`).join('')}</div>
<h2>Complete OCR ID ledger</h2><p>Every frozen ID, including exclusions and omissions; repeated occurrences remain visible.</p><table><thead><tr><th>ID</th><th>Frozen OCR</th><th>All raw memberships / exclusions</th></tr></thead><tbody>${model.words.map((w) => `<tr class="${c.duplicates.includes(w.id) ? 'conflict' : ''}"><td>${e(w.id)}</td><td>${e(w.text)}</td><td>${e(w.occurrences.map((o) => (o.passage ? `P${o.passage}.${o.order}: ${o.text}` : `EXCLUDED ${o.exclusion}: ${o.reason}`)).join(' | ') || 'UNASSIGNED')}</td></tr>`).join('')}</tbody></table>
<details><summary>Coverage diagnostics and source hashes</summary><pre>${e(JSON.stringify({ coverage: c, evidence }, null, 2))}</pre></details>
<script>const model=${JSON.stringify(model).replace(/</g, '\\u003c')};const detail=document.querySelector('#detail');const select=document.querySelector('#passage');function filter(){document.querySelectorAll('.mark').forEach(el=>el.classList.toggle('dim',select.value!=='all'&&el.dataset.p!==select.value));}select.onchange=filter;document.querySelector('#zoom').onclick=()=>document.body.classList.toggle('zoom');document.querySelectorAll('.mark,.token').forEach(el=>{const show=()=>{const id=el.dataset.id;const w=model.words.find(w=>w.id===id);const p=model.passages.find(p=>String(p.number)===el.dataset.p);const t=p?.tokens.find(t=>String(t.order)===el.dataset.order||t.id===id);detail.textContent=JSON.stringify({id,token:t,frozenOCR:w},null,2);document.querySelectorAll('.mark').forEach(m=>m.classList.toggle('selected',id!=='null'&&m.dataset.id===id));};el.onclick=show;el.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();show();}};});</script></html>`;
}

export function createDiagnostic(manifestFile, freezeFile, resultDirectory, outputParent) {
	if (freezeFile && !existsSync(freezeFile))
		throw new Error(`Freeze file not found: ${freezeFile}`);
	const evidenceCheck = sourceEvidence(manifestFile, freezeFile ?? undefined),
		manifest = evidenceCheck.manifest,
		freeze = evidenceCheck.frozen
			? json(freezeFile ?? resolve(dirname(manifestFile), 'freeze.json'))
			: null;
	const requestFile = resolve(resultDirectory, 'source-request.json');
	const responseFile = resolve(resultDirectory, 'source-response.json');
	const reportFile = resolve(resultDirectory, 'report.json');
	const preparedRequest = resolve(dirname(manifestFile), 'source-request.json');
	const checks = [...evidenceCheck.hashes];
	if (!freeze && sha(preparedRequest) !== sha(requestFile))
		throw new Error('Replay request differs from prepared request');
	if (freeze && sha(requestFile) !== freeze.requestSha256)
		throw new Error(`Frozen evidence hash mismatch: ${requestFile}`);
	const files = [
		...new Set([...checks.map(([f]) => f), preparedRequest, requestFile, responseFile, reportFile])
	];
	const before = Object.fromEntries(files.map((f) => [f, sha(f)]));
	const response = json(responseFile);
	if (
		!response ||
		typeof response !== 'object' ||
		!response.value ||
		!Array.isArray(response.value.passages) ||
		!Array.isArray(response.value.exclusions)
	)
		throw new Error(
			'Recorded source response is malformed: expected value.passages and value.exclusions arrays'
		);
	const model = inspectMembership(json(requestFile), response);
	const report = json(reportFile);
	const evidence = {
		savedStatus: report.status,
		savedStructuralValidation: report.structuralValidation,
		savedError: report.error,
		sha256: before,
		note: 'Read-only projection. No validation repair, balloon inference, provider call, OCR refresh, or export.'
	};
	const parent = realpathSync(outputParent),
		evidenceDir = realpathSync(resultDirectory),
		fromEvidence = relative(evidenceDir, parent);
	if (
		fromEvidence === '' ||
		(!isAbsolute(fromEvidence) &&
			fromEvidence !== '..' &&
			!fromEvidence.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')))
	)
		throw new Error('Use a separate diagnostic directory');
	const out = privateOutput(parent);
	writeFileSync(
		resolve(out, 'comparison.html'),
		diagnosticHtml(
			model,
			`data:image/${mimeFor(manifest.page.image)};base64,${readFileSync(manifest.page.image).toString('base64')}`,
			evidence
		)
	);
	writeFileSync(resolve(out, 'diagnostic.json'), JSON.stringify({ ...model, evidence }, null, 2));
	for (const file of files)
		if (sha(file) !== before[file]) throw new Error(`Evidence changed: ${file}`);
	return out;
}
const mimeFor = (file) =>
	({ '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.svg': 'svg+xml' })[
		extname(file).toLowerCase()
	] ?? 'octet-stream';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		if (![5, 6].includes(process.argv.length))
			throw new Error(
				'Usage: node tools/vision-pilot/source-diagnostic.mjs MANIFEST [FREEZE] RESULT_DIRECTORY IGNORED_OUTPUT_PARENT'
			);
		const args = process.argv.slice(2);
		console.log(
			args.length === 3
				? createDiagnostic(args[0], null, args[1], args[2])
				: createDiagnostic(...args)
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
	}
}
