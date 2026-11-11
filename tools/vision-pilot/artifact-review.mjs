import { createHash } from 'node:crypto';
import { extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { escape } from '../merge-eval/report.mjs';
import { privateOutput } from './private-output.mjs';

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const need = (condition, message) => {
	if (!condition) throw new Error(message);
};
const finitePositive = (value) => Number.isFinite(value) && value > 0;
const mime = (file) => {
	const type = {
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.png': 'image/png',
		'.svg': 'image/svg+xml',
		'.webp': 'image/webp'
	}[extname(file).toLowerCase()];
	need(type, 'Review images must be PNG, JPEG, WebP or SVG');
	return type;
};

function validate(manifest, manifestFile) {
	need(manifest?.schemaVersion === 1, 'Expected artifact review schemaVersion 1');
	need(typeof manifest.title === 'string' && manifest.title.trim(), 'Review title is required');
	need(Array.isArray(manifest.pages) && manifest.pages.length, 'At least one page is required');
	const pageIds = new Set();
	const inputFiles = new Set([realpathSync(manifestFile)]);
	const pages = manifest.pages.map((page) => {
		need(typeof page.id === 'string' && page.id.trim(), 'Each page needs an ID');
		need(!pageIds.has(page.id), `Duplicate page ID: ${page.id}`);
		pageIds.add(page.id);
		need(finitePositive(page.width) && finitePositive(page.height), `Invalid size: ${page.id}`);
		need(
			Array.isArray(page.variants) && page.variants.length >= 2,
			`Need two variants: ${page.id}`
		);
		const variantIds = new Set();
		const variants = page.variants.map((variant) => {
			need(typeof variant.id === 'string' && variant.id.trim(), 'Each variant needs an ID');
			need(!variantIds.has(variant.id), `Duplicate variant ID: ${page.id}/${variant.id}`);
			variantIds.add(variant.id);
			need(typeof variant.label === 'string' && variant.label.trim(), 'Each variant needs a label');
			need(typeof variant.image === 'string' && variant.image, 'Each variant needs an image path');
			const file = realpathSync(resolve(dirname(manifestFile), variant.image));
			inputFiles.add(file);
			return {
				id: variant.id,
				label: variant.label,
				image: `data:${mime(file)};base64,${readFileSync(file).toString('base64')}`
			};
		});
		const passageIds = new Set();
		const passages = (page.passages ?? []).map((passage) => {
			need(typeof passage.id === 'string' && passage.id.trim(), 'Each passage needs an ID');
			need(!passageIds.has(passage.id), `Duplicate passage ID: ${page.id}/${passage.id}`);
			passageIds.add(passage.id);
			need(
				Array.isArray(passage.view) &&
					passage.view.length === 4 &&
					passage.view.every(Number.isFinite),
				`Invalid passage view: ${page.id}/${passage.id}`
			);
			const [x, y, width, height] = passage.view;
			need(
				x >= 0 &&
					y >= 0 &&
					finitePositive(width) &&
					finitePositive(height) &&
					x + width <= page.width &&
					y + height <= page.height,
				`Passage view outside page: ${page.id}/${passage.id}`
			);
			return {
				id: passage.id,
				label: passage.label ?? passage.id,
				view: passage.view,
				note: passage.note ?? '',
				provenance: passage.provenance ?? 'unspecified'
			};
		});
		return {
			id: page.id,
			label: page.label ?? page.id,
			width: page.width,
			height: page.height,
			note: page.note ?? '',
			variants,
			passages
		};
	});
	return { pages, inputFiles: [...inputFiles] };
}

function reviewHtml(manifest, pages) {
	const payload = JSON.stringify(pages).replaceAll('<', '\\u003c');
	const script = `const pages=JSON.parse(document.querySelector('#review-data').textContent),page=document.querySelector('#page'),passage=document.querySelector('#passage'),grid=document.querySelector('.grid');
const option=(value,text)=>new Option(text,value); pages.forEach((p,i)=>page.add(option(i,p.label)));
function draw(){const data=pages[Number(page.value)],selected=Number(passage.value),item=selected<0?null:data.passages[selected],view=item?.view??[0,0,data.width,data.height]; grid.replaceChildren(...data.variants.map(v=>{const figure=document.createElement('figure'),caption=document.createElement('figcaption'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),image=document.createElementNS(svg.namespaceURI,'image'); caption.textContent=v.label; svg.setAttribute('viewBox',view.join(' ')); svg.setAttribute('width',view[2]); svg.setAttribute('height',view[3]); svg.setAttribute('role','img'); svg.setAttribute('aria-label',v.label+' — '+(item?.label??data.label)); image.setAttribute('href',v.image); image.setAttribute('width',data.width); image.setAttribute('height',data.height); svg.append(image); figure.append(caption,svg); return figure;})); grid.style.setProperty('--columns',data.variants.length); document.querySelector('#context').textContent=(item?.note||data.note||'No review note.')+' Provenance: '+(item?.provenance??'page-level saved artifact')+'.';}
function changePage(){const data=pages[Number(page.value)]; passage.replaceChildren(option(-1,'Full page'),...data.passages.map((p,i)=>option(i,p.label))); passage.value=-1; draw();}
page.addEventListener('change',changePage); passage.addEventListener('change',draw); changePage();`;
	const scriptHash = createHash('sha256').update(script).digest('base64');
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'"><title>${escape(manifest.title)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f4f1;color:#17201d;font:16px/1.45 system-ui}header{position:sticky;top:0;z-index:2;padding:.7rem 1rem;background:white;border-bottom:1px solid #aaa}h1{font-size:1.35rem;margin:0 0 .5rem}.controls{display:flex;gap:.6rem 1.2rem;align-items:end;flex-wrap:wrap}label span{display:block;font-size:.82rem}select{font:inherit;max-width:min(34rem,90vw)}#context{margin:.55rem 0 0;color:#43534d}.grid{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:1rem;padding:1rem;overflow:auto}figure{margin:0;min-width:0}figcaption{font-weight:650;margin-bottom:.35rem}svg{display:block;width:100%;height:auto;background:white}body:has(#pixels:checked) .grid{grid-template-columns:repeat(var(--columns),max-content)}body:has(#pixels:checked) svg{width:initial}@media(max-width:760px){.grid{grid-template-columns:1fr!important}body:has(#pixels:checked) .grid{grid-template-columns:repeat(var(--columns),max-content)!important}}
</style></head><body><header><h1>${escape(manifest.title)}</h1><div class="controls"><label><span>Page</span><select id="page"></select></label><label><span>Passage or crop</span><select id="passage"></select></label><label><input id="pixels" type="checkbox"> Original pixel size</label></div><p id="context" aria-live="polite"></p></header><main class="grid"></main><script id="review-data" type="application/json">${payload}</script><script>${script}</script></body></html>`;
}

/** Build a standalone, read-only gallery from already generated image artifacts. */
export function artifactReview(manifestFile, outputParent) {
	manifestFile = realpathSync(manifestFile);
	const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
	const { pages, inputFiles } = validate(manifest, manifestFile);
	const before = Object.fromEntries(inputFiles.map((file) => [file, hash(file)]));
	const output = privateOutput(outputParent);
	writeFileSync(resolve(output, 'index.html'), reviewHtml(manifest, pages), { flag: 'wx' });
	writeFileSync(
		resolve(output, 'report.json'),
		JSON.stringify(
			{
				schemaVersion: 1,
				mode: 'saved-artifact-review',
				networkInference: false,
				manifest: manifestFile,
				inputHashes: before,
				pages: pages.map((page) => ({
					id: page.id,
					variants: page.variants.map(({ id, label }) => ({ id, label })),
					passages: page.passages.length
				}))
			},
			null,
			2
		) + '\n',
		{ flag: 'wx' }
	);
	for (const [file, digest] of Object.entries(before))
		need(hash(file) === digest, `Review input changed: ${file}`);
	return { output, review: resolve(output, 'index.html'), report: resolve(output, 'report.json') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length !== 4)
		throw new Error(
			'Usage: node tools/vision-pilot/artifact-review.mjs MANIFEST.json EXISTING_OUTPUT_DIRECTORY'
		);
	console.log(JSON.stringify(artifactReview(resolve(process.argv[2]), resolve(process.argv[3]))));
}
