import {
	existsSync,
	copyFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	realpathSync,
	constants
} from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
	baseline,
	baselineBubbles,
	pilotRequests,
	visionBubbles,
	wordsFromBbl,
	Ledger,
	RecordedAdapter,
	call,
	json,
	save,
	hash
} from './core.mjs';
import { renderer } from './render.mjs';
import { typographyAssets, writeAlbumTypography } from './typography.mjs';
import { privateOutput } from './private-output.mjs';
export { privateOutput } from './private-output.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataImage = (file) =>
	`data:image/${extname(file).slice(1) === 'jpg' ? 'jpeg' : extname(file).slice(1) === 'svg' ? 'svg+xml' : extname(file).slice(1)};base64,${readFileSync(file).toString('base64')}`;

export async function run(manifestFile, recordingsFile, parent) {
	const manifest = json(manifestFile),
		recordings = json(recordingsFile);
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.pages) || !manifest.pages.length)
		throw new Error('Invalid manifest');
	const out = privateOutput(parent);
	const report = {
		schemaVersion: 1,
		mode: 'offline-replay',
		created: new Date().toISOString(),
		status: 'incomplete',
		revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
		dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
		inputs: {},
		implementation: {},
		pages: [],
		failures: [],
		dispatched: 0,
		networkDispatches: 0,
		measuredChargeEuro: 0,
		review: {
			zeroEditPages: null,
			presentation: [],
			reason:
				'Requires human artwork and translation review; synthetic success is plumbing evidence only'
		}
	};
	const remember = (file) => {
		file = realpathSync(file);
		report.inputs[file] = hash(file);
		return file;
	};
	remember(manifestFile);
	if (recordingsFile) remember(recordingsFile);
	for (const f of [
		'src/lib/ocr.ts',
		'src/lib/mergeBubbles.ts',
		'src/lib/textCleanup.ts',
		'src/lib/ComicBubble.svelte',
		'src/lib/maskAppearance.ts',
		'src/lib/bbl/metadata.ts',
		'src/lib/bbl/FontResources.ts',
		'src/lib/types/Comic.ts',
		'package-lock.json',
		'tools/vision-pilot/core.mjs',
		'src/lib/passageFilter.ts',
		'tools/vision-pilot/run.mjs',
		'tools/vision-pilot/render.mjs',
		'tools/vision-pilot/lettering.mjs',
		'tools/vision-pilot/Viewer.svelte'
	])
		report.implementation[f] = hash(resolve(root, f));
	const ledger = new Ledger(resolve(out, 'ledger.json'), manifest.capEuro, manifest.rates);
	const adapter = new RecordedAdapter(recordings);
	let render;
	try {
		const fontAssets = typographyAssets(manifest.typography);
		if (manifest.typography) {
			remember(manifest.typography.settings.path);
			for (const face of manifest.typography.faces) remember(face.path);
		}
		render = await renderer(out, fontAssets);
		const seen = new Set();
		for (const [i, p] of manifest.pages.entries()) {
			if (!/^[a-zA-Z0-9_-]+$/.test(p.id) || seen.has(p.id))
				throw new Error('Invalid/duplicate page ID');
			seen.add(p.id);
			const image = remember(resolve(dirname(manifestFile), p.image)),
				ocr = remember(resolve(dirname(manifestFile), p.ocr));
			if (
				(p.imageSha256 && hash(image) !== p.imageSha256) ||
				(p.ocrSha256 && hash(ocr) !== p.ocrSha256)
			)
				throw new Error('Frozen input hash mismatch');
			const raw = json(ocr),
				page = {
					...p,
					sourceLanguage: manifest.sourceLanguage,
					targetLanguage: manifest.targetLanguage,
					words: wordsFromBbl(raw, p.imageSize)
				};
			if (
				!manifest.sourceLanguage ||
				['und', 'ocr', 'org'].includes(manifest.sourceLanguage.toLowerCase()) ||
				!manifest.targetLanguage ||
				manifest.sourceLanguage === manifest.targetLanguage
			)
				throw new Error('Explicit distinct source/target languages required');
			// Old freezes retain their font; new preparations carry verified album assets.
			const font = { ...raw.font, ...raw.pages[0].font, ...manifest.font };
			const prepared = await baseline(page, i);
			const requests = pilotRequests(manifest, page, prepared, {
				path: image,
				sha256: hash(image),
				size: p.imageSize
			});
			const result = {
				id: p.id,
				words: page.words.length,
				baselineFilteredGroups: prepared.bubbles.length,
				methods: {}
			};
			report.pages.push(result);
			report.review.presentation.push({
				id: p.id,
				A: i % 2 ? 'baseline' : 'vision',
				B: i % 2 ? 'vision' : 'baseline'
			});
			for (const method of ['baseline', 'vision']) {
				const key = `${p.id}:${method}`;
				save(resolve(out, `${p.id}-${method}-request.json`), requests[method]);
				try {
					const rec = await call(
						adapter,
						ledger,
						key,
						requests[method],
						p.maximum[method],
						method === 'vision' ? 'delivery' : 'comparison',
						p.ocrMode === 'reused',
						(rec) => {
							save(resolve(out, `${p.id}-${method}-response.json`), rec);
						}
					);
					const bubbles = (
						method === 'vision'
							? visionBubbles(rec.value, page, manifest.responseContract)
							: baselineBubbles(rec.value, prepared, page.targetLanguage)
					).map((b) => ({
						...b,
						...(manifest.maskStyle ? { style: { ...b.style, ...manifest.maskStyle } } : {})
					}));
					const album = resolve(out, 'overlays', method);
					mkdirSync(album, { recursive: true });
					if (manifest.typography && !existsSync(resolve(album, 'album.bbl')))
						writeAlbumTypography(album, manifest.typography);
					const filename = `overlays/${method}/${p.id}.${page.targetLanguage}.bbl`;
					const artwork = resolve(album, `${p.id}${extname(image)}`);
					copyFileSync(image, artwork, constants.COPYFILE_EXCL);
					save(resolve(out, filename), {
						lang: page.targetLanguage,
						...(font ? { font } : {}),
						pages: [{ bubbles: await render.fit(bubbles, font) }]
					});
					const label = report.review.presentation[i].A === method ? 'A' : 'B';
					const rendering = await render.render(
						`${p.id}-${method}`,
						resolve(out, filename),
						dataImage(image),
						p.imageSize,
						{
							file: `${p.id}-${label}-comparison.html`,
							source: manifest.sourceLanguage,
							target: manifest.targetLanguage
						}
					);
					if (hash(artwork) !== hash(image)) throw new Error('Copied artwork changed');
					result.methods[method] = {
						status: 'rendered',
						bbl: filename,
						reviewRendering: `${p.id}-${method}.review.png`,
						...rendering
					};
				} catch (e) {
					result.methods[method] = { status: 'failed', error: e.message };
					report.failures.push({ key, error: e.message });
				}
			}
		}
		report.status = report.failures.length ? 'recorded-failures' : 'complete';
	} catch (e) {
		report.failures.push({ error: e.message });
		report.status = 'failed';
	} finally {
		if (render) await render.close();
		report.dispatched = adapter.dispatches;
		report.inputsUnchanged = Object.entries(report.inputs).every(
			([file, digest]) => existsSync(file) && hash(file) === digest
		);
		if (!report.inputsUnchanged) {
			report.status = 'failed';
			report.failures.push({ error: 'INPUT HASH CHANGED' });
		}
		report.costs = Object.fromEntries(
			['delivery', 'comparison'].map((scope) => [
				scope,
				{
					simulatedHeldEuro:
						ledger.data.entries
							.filter((e) => e.scope === scope)
							.reduce((s, e) => s + e.heldMicroEuro, 0) / 1e6,
					measuredChargeEuro: 0
				}
			])
		);
		const escape = (s) =>
			String(s)
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;');
		const comparison = report.pages
			.map((p) => {
				const order = report.review.presentation.find((r) => r.id === p.id);
				return `<section><h2>${escape(p.id)}</h2><div class="pair">${['A', 'B']
					.map((label) => {
						const m = p.methods[order[label]];
						return `<figure><figcaption>${label}</figcaption>${m?.status === 'rendered' ? `<a href="${escape(m.comparison)}"><img src="data:image/png;base64,${readFileSync(resolve(out, m.reviewRendering)).toString('base64')}" alt="${label} translated page">Compare with original</a>` : '<p>Recorded failure; no rendering</p>'}</figure>`;
					})
					.join('')}</div></section>`;
			})
			.join('');
		writeFileSync(
			resolve(out, 'index.html'),
			`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Offline pilot review</title><style>body{font-family:sans-serif;margin:20px}.pair{display:flex;gap:20px}figure{margin:0;width:50%}img{width:100%;height:auto}figcaption{font-weight:bold}</style></head><body><h1>Offline paired review</h1><p>Judge each page as delivered. Record the first edit needed, source fidelity, order, missing lettering and layout. Method key is separate in report.json. Browser zoom is available.</p>${comparison}</body></html>`,
			{ flag: 'wx' }
		);
		save(
			resolve(out, 'review-template.json'),
			report.pages.map((p) => ({
				id: p.id,
				textBearing: null,
				A: { zeroEdits: null, firstEdit: null, otherErrors: [] },
				B: { zeroEdits: null, firstEdit: null, otherErrors: [] }
			}))
		);
		save(resolve(out, 'report.json'), report);
	}
	return { out, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (
		args.length !== 6 ||
		args[0] !== '--manifest' ||
		args[2] !== '--recordings' ||
		args[4] !== '--output'
	) {
		console.error(
			'Offline only: node --import ./tools/merge-eval/register.mjs tools/vision-pilot/run.mjs --manifest FILE --recordings FILE --output EXISTING_PRIVATE_DIRECTORY'
		);
		process.exitCode = 2;
	} else {
		const { out, report } = await run(resolve(args[1]), resolve(args[3]), resolve(args[5]));
		console.log(
			JSON.stringify({
				output: out,
				status: report.status,
				failures: report.failures.length,
				inputsUnchanged: report.inputsUnchanged
			})
		);
		if (report.status !== 'complete') process.exitCode = 2;
	}
}
