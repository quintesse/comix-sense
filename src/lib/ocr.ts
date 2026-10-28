import { BblShapeType, type Bubble } from './types/Comic';
import { mergeBubbles } from './mergeBubbles';

type Annotation = {
	description?: string;
	locale?: string;
	boundingPoly?: { vertices?: { x?: number; y?: number }[] };
};
export type VisionResult = {
	error?: { message?: string };
	textAnnotations?: Annotation[];
};

/** Match tools/ocr2bbl.java: skip aggregate text and enclose each word polygon. */
export function visionToBubbles(result: VisionResult): { lang: string; bubbles: Bubble[] } {
	if (result.error) throw new Error(result.error.message || 'Google Vision recognition failed.');
	const annotations = result.textAnnotations ?? [];
	const locale = (annotation: Annotation, fallback: string) =>
		annotation.locale?.trim() ? annotation.locale : fallback;
	const lang = annotations.length ? locale(annotations[0], 'und') : 'und';
	const bubbles = annotations.slice(1).map((annotation, index): Bubble => {
		const vertices = annotation.boundingPoly?.vertices;
		if (!vertices?.length) throw new Error(`Word annotation ${index + 1} has no vertices.`);
		const xs = vertices.map((vertex) => vertex.x ?? 0);
		const ys = vertices.map((vertex) => vertex.y ?? 0);
		if (![...xs, ...ys].every(Number.isFinite) || typeof annotation.description !== 'string')
			throw new Error(`Word annotation ${index + 1} is invalid.`);
		return {
			text: annotation.description,
			lang: locale(annotation, lang),
			shape: {
				type: BblShapeType.box,
				vs: [
					{ x: Math.min(...xs), y: Math.min(...ys) },
					{ x: Math.max(...xs), y: Math.max(...ys) }
				]
			}
		};
	});
	return { lang, bubbles };
}

export async function scanImage(image: Blob, apiKey: string, signal?: AbortSignal) {
	const content = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve((reader.result as string).split(',')[1]);
		reader.onerror = () => reject(new Error('Could not read the page image.'));
		reader.readAsDataURL(image);
	});
	const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
		body: JSON.stringify({
			requests: [{ image: { content }, features: [{ type: 'TEXT_DETECTION' }] }]
		}),
		signal
	});
	const data = await response.json();
	if (!response.ok || data.error)
		throw new Error(data.error?.message || `Google Vision request failed (${response.status}).`);
	if (!Array.isArray(data.responses) || data.responses.length !== 1)
		throw new Error('Google Vision returned an invalid response.');
	const result = visionToBubbles(data.responses[0]);
	return {
		lang: result.lang,
		bubbles: mergeBubbles(result.bubbles).filter((bubble) => /\p{L}/u.test(bubble.text))
	};
}
