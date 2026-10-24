import type { Bubble, Comic } from './types/Comic';
import {
	completionUrl,
	normalizeAiSettings,
	resolveSourceLanguage,
	type AiSettings
} from './textCleanup';
import { renderPrompt } from './renderPrompt';

export type RenderDocument = {
	sourceLanguage: string;
	targetLanguage: string;
	items: { source: string; target: string }[];
};

export function isRenderLanguage(language: string): boolean {
	return (
		/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(language) &&
		!['org', 'ocr', 'mrg', 'und', 'mul'].includes(language.toLowerCase())
	);
}

/** MRG/OCR contain original lettering and its language; translation preserves bubble indexes. */
export async function prepareRender(comic: Comic, language: string): Promise<RenderDocument> {
	if (!isRenderLanguage(language)) throw new Error('Select a translated language to render.');
	if (!comic.languages.includes(language)) throw new Error('No translated bubbles for this page.');
	const overlays = ['mrg', 'ocr'].flatMap((code) => {
		const overlay = comic.languages.find((value) => value.toLowerCase() === code);
		return overlay ? [overlay] : [];
	});
	if (!overlays.length) throw new Error('An OCR or MRG overlay is required before rendering.');
	const [originals, target] = await Promise.all([
		Promise.all(
			overlays.map(async (overlay) => ({
				overlay,
				bubbles: await comic.getBubbles(overlay),
				declaredLanguage: comic.sourceLanguage(overlay)
			}))
		),
		comic.getBubbles(language)
	]);
	const original = originals.find(
		({ bubbles }) => bubbles.length > 0 && bubbles.length === target.length
	);
	if (!original)
		throw new Error('Original and translated bubble counts must match before rendering.');
	const source = original.bubbles;
	const sourceLanguage = [original, ...originals.filter((entry) => entry !== original)]
		.map((entry) => resolveSourceLanguage(entry.overlay, [entry]))
		.find((code) => code !== 'und');
	if (!sourceLanguage)
		throw new Error('Set the original language in the OCR or MRG information before rendering.');
	return {
		sourceLanguage,
		targetLanguage: language,
		items: source.map((bubble: Bubble, index) => ({
			source: bubble.text,
			target: target[index].text
		}))
	};
}

export function renderSize(width: number, height: number): string {
	if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0))
		throw new Error('Invalid original image dimensions.');
	return `${Math.ceil(width / 16) * 16}x${Math.ceil(height / 16) * 16}`;
}

export async function requestRender(
	document: RenderDocument,
	image: Blob,
	dimensions: { width: number; height: number },
	settings: AiSettings,
	signal?: AbortSignal
): Promise<Blob> {
	const config = normalizeAiSettings(settings);
	if (!config.render.model.trim()) throw new Error('Configure a Render image model in Settings.');
	const url = new URL(completionUrl(config.url));
	url.pathname = url.pathname.replace(/\/chat\/completions$/, '/images/edits');
	const form = new FormData();
	form.set('model', config.render.model.trim());
	const prompt = (config.render.prompt ?? renderPrompt).replace(
		/\{(sourceLanguage|targetLanguage)\}/g,
		(_match, key: 'sourceLanguage' | 'targetLanguage') => document[key]
	);
	form.set('prompt', `${prompt}\n${JSON.stringify(document, null, 2)}`);
	form.set('size', renderSize(dimensions.width, dimensions.height));
	form.set('quality', config.render.quality);
	form.set('output_format', config.render.format === 'jpg' ? 'jpeg' : config.render.format);
	form.set('n', '1');
	const extension =
		image.type === 'image/jpeg' ? 'jpg' : image.type === 'image/webp' ? 'webp' : 'png';
	form.set('image', image, `original.${extension}`);
	const response = await fetch(url.href, {
		method: 'POST',
		body: form,
		headers: config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {},
		signal
	});
	if (!response.ok)
		throw new Error(
			`Image request failed (HTTP ${response.status}). Check the model, quality, dimensions and API access.`
		);
	const data = await response.json();
	console.log('AI usage:', {
		operation: 'render',
		model: data?.model ?? config.render.model.trim(),
		usage: data?.usage ?? 'unknown'
	});
	const encoded = data?.data?.[0]?.b64_json;
	if (typeof encoded !== 'string' || !encoded) throw new Error('Image model returned no image.');
	let bytes: Uint8Array<ArrayBuffer>;
	try {
		bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
	} catch {
		throw new Error('Image model returned invalid image data.');
	}
	const startsWith = (signature: number[], offset = 0) =>
		signature.every((value, index) => bytes[index + offset] === value);
	const valid = {
		png: startsWith([137, 80, 78, 71, 13, 10, 26, 10]),
		jpg: startsWith([255, 216, 255]),
		webp: startsWith([82, 73, 70, 70]) && startsWith([87, 69, 66, 80], 8)
	};
	if (!valid[config.render.format])
		throw new Error(`Image model did not return a ${config.render.format.toUpperCase()} image.`);
	signal?.throwIfAborted();
	return new Blob([bytes], {
		type: `image/${config.render.format === 'jpg' ? 'jpeg' : config.render.format}`
	});
}
