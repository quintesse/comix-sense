// Offline source grouping replay: no provider transport or credentials.
import { copyFileSync, constants, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { sourceEvidence } from './source-evidence.mjs';
import { hash, json, save, wordsFromBbl } from './core.mjs';
import {
	sourceRequest,
	validateSource,
	sourceBubbles,
	sourceOverlayPassages,
	SOURCE_PROMPT_REVISION
} from './source.mjs';
import { privateOutput } from './run.mjs';
import { renderer } from './render.mjs';
import {
	albumTypography,
	typographyAssets,
	writeAlbumTypography,
	defaultFont
} from './typography.mjs';

export function prepareSource(image, ocr, sourceLanguage, parent, imageSize) {
	const out = privateOutput(parent);
	const manifest = {
		schemaVersion: 1,
		stage: 'source-grouping-v1',
		sourcePromptRevision: SOURCE_PROMPT_REVISION,
		sourceLanguage,
		provider: 'recorded',
		model: 'offline',
		maximum: { output: 4096 },
		page: {
			image: resolve(image),
			ocr: resolve(ocr),
			imageSize,
			imageSha256: hash(image),
			ocrSha256: hash(ocr)
		}
	};
	const page = loadPage(manifest);
	const request = sourceRequest(manifest, page, imageFor(page));
	save(resolve(out, 'manifest.json'), manifest);
	save(resolve(out, 'source-request.json'), request);
	save(resolve(out, 'freeze.json'), {
		manifestSha256: hash(resolve(out, 'manifest.json')),
		requestSha256: hash(resolve(out, 'source-request.json')),
		inputHashes: { image: page.imageSha256, ocr: page.ocrSha256 }
	});
	return out;
}
function loadPage(manifest) {
	if (manifest.schemaVersion !== 1 || manifest.stage !== 'source-grouping-v1')
		throw Error('Invalid source manifest');
	const p = manifest.page;
	if (
		!Number.isSafeInteger(p.imageSize?.width) ||
		!Number.isSafeInteger(p.imageSize?.height) ||
		p.imageSize.width <= 0 ||
		p.imageSize.height <= 0
	)
		throw Error('Positive integer image dimensions required');
	if (hash(p.image) !== p.imageSha256 || hash(p.ocr) !== p.ocrSha256)
		throw Error('Frozen source input hash mismatch');
	return {
		...p,
		sourceLanguage: manifest.sourceLanguage,
		words: wordsFromBbl(json(p.ocr), p.imageSize)
	};
}
const imageFor = (p) => ({ path: p.image, sha256: p.imageSha256, size: p.imageSize });

export async function runSource(manifestFile, recordingsFile, parent) {
	const evidence = sourceEvidence(manifestFile);
	const manifest = evidence.manifest,
		page = loadPage(manifest);
	const request = sourceRequest(manifest, page, imageFor(page));
	if (evidence.frozen && !isDeepStrictEqual(request, json(evidence.requestFile)))
		throw new Error('Frozen source request differs from implementation; prepare a new experiment');
	const out = privateOutput(parent);
	const inputs = new Map([...evidence.hashes, [recordingsFile, hash(recordingsFile)]]);
	const report = {
		stage: manifest.stage,
		mode: 'offline-replay',
		status: 'failed',
		structuralValidation: 'not-run',
		measuredChargeEuro: 0,
		networkDispatches: 0,
		visualGroupingAccuracy: 'Unreviewed; synthetic replay proves plumbing only'
	};
	let render;
	try {
		save(resolve(out, 'source-request.json'), request);
		const record = json(recordingsFile)['page:source'];
		if (!record) throw Error('No recording for page:source');
		save(resolve(out, 'source-response.json'), record);
		if (record.timeout || record.finishReason !== 'stop')
			throw Error('Incomplete/refused recorded response');
		report.structuralValidation = 'failed';
		const mapping = validateSource(record.value, page);
		report.structuralValidation = 'passed';
		const retained = sourceOverlayPassages(mapping);
		report.overlayPassageIds = retained.map((p) => p.id);
		report.skippedPassageIds = mapping.passages
			.filter((p) => !retained.includes(p))
			.map((p) => p.id);
		// Preserve all accounted tokens, including skipped passages and false OCR exclusions.
		save(resolve(out, 'passage-token-mapping.json'), {
			...mapping,
			overlayPassageIds: report.overlayPassageIds,
			skippedPassageIds: report.skippedPassageIds
		});
		const typography = albumTypography(resolve(dirname(page.image), 'album.bbl'));
		if (typography) {
			inputs.set(typography.settings.path, typography.settings.sha256);
			for (const face of typography.faces) inputs.set(face.path, face.sha256);
		}
		const font = typography?.font ?? defaultFont;
		render = await renderer(out, typographyAssets(typography));
		const fitted = await render.fit(sourceBubbles(mapping, page), font);
		const album = resolve(out, 'album');
		mkdirSync(album);
		writeAlbumTypography(album, typography);
		const stem = basename(page.image, extname(page.image));
		copyFileSync(page.image, resolve(album, basename(page.image)), constants.COPYFILE_EXCL);
		copyFileSync(page.ocr, resolve(album, stem + '.OCR.bbl'), constants.COPYFILE_EXCL);
		const mrg = resolve(album, stem + '.MRG.bbl');
		save(mrg, { lang: page.sourceLanguage, font, pages: [{ bubbles: fitted }] });
		const mime =
			extname(page.image).toLowerCase() === '.svg'
				? 'svg+xml'
				: /\.jpe?g$/i.test(page.image)
					? 'jpeg'
					: 'png';
		const image = `data:image/${mime};base64,${readFileSync(page.image).toString('base64')}`;
		report.rendering = await render.render('source', mrg, image, page.imageSize, {
			file: 'comparison.html',
			source: page.sourceLanguage,
			target: page.sourceLanguage
		});
		if (
			hash(resolve(album, basename(page.image))) !== page.imageSha256 ||
			hash(resolve(album, stem + '.OCR.bbl')) !== page.ocrSha256
		)
			throw Error('Copied input hash mismatch');
		report.album = album;
		report.status = 'complete';
	} catch (error) {
		report.error = error.message;
	} finally {
		if (render) await render.close();
		report.inputsUnchanged = [...inputs].every(
			([file, digest]) => existsSync(file) && hash(file) === digest
		);
		if (!report.inputsUnchanged) {
			report.status = 'failed';
			report.error = 'Input hash changed';
		}
		report.inputs = Object.fromEntries(inputs);
		save(resolve(out, 'report.json'), report);
	}
	return { out, report };
}
export async function main(args) {
	if (args[0] === 'prepare' && args.length === 7) {
		console.log(
			prepareSource(resolve(args[1]), resolve(args[2]), args[3], resolve(args[6]), {
				width: Number(args[4]),
				height: Number(args[5])
			})
		);
	} else if (args[0] === 'replay' && args.length === 4) {
		const result = await runSource(resolve(args[1]), resolve(args[2]), resolve(args[3]));
		console.log(JSON.stringify(result));
		if (result.report.status !== 'complete') process.exitCode = 2;
	} else
		throw Error(
			'Offline only: source-run.mjs prepare IMAGE OCR SOURCE_LANGUAGE WIDTH HEIGHT OUTPUT_PARENT | replay MANIFEST RECORDINGS OUTPUT_PARENT'
		);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
	}
}
