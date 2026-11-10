import { mergeOcrBubbles, canAnalyzeOcrPixels } from './ocr';
import type { Bubble } from './types/Comic';

/** Browser-only merge. Pixel buffers are transferred and must not be reused afterward. */
export async function mergeOcrForPage(
	words: Bubble[],
	pixels?: ImageData,
	signal?: AbortSignal,
	useInclination = false
): Promise<Bubble[]> {
	signal?.throwIfAborted();
	// Svelte state can contain proxies; workers receive only plain BBL data.
	const snapshot = JSON.parse(JSON.stringify(words)) as Bubble[];
	if (pixels && !canAnalyzeOcrPixels(pixels.width, pixels.height)) pixels = undefined;
	if (!pixels && !useInclination) return mergeOcrBubbles(snapshot);
	const image = pixels;
	return new Promise<Bubble[]>((resolve, reject) => {
		const worker = new Worker(new URL('./ocrMerge.worker.ts', import.meta.url), { type: 'module' });
		let settled = false;
		const finish = (bubbles?: Bubble[], error?: unknown) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', abort);
			worker.terminate();
			if (error !== undefined) reject(error);
			else resolve(bubbles!);
		};
		const abort = () =>
			finish(undefined, signal?.reason ?? new DOMException('OCR merge cancelled.', 'AbortError'));
		worker.onmessage = ({ data }: MessageEvent<{ bubbles?: Bubble[]; error?: string }>) => {
			if (data.error !== undefined) finish(undefined, new Error(data.error));
			else if (Array.isArray(data.bubbles)) finish(data.bubbles);
			else finish(undefined, new Error('OCR merge worker returned an invalid result.'));
		};
		worker.onerror = (event) => {
			event.preventDefault();
			finish(undefined, new Error(event.message || 'OCR merge worker failed.'));
		};
		worker.onmessageerror = () =>
			finish(undefined, new Error('Could not read OCR merge worker response.'));
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) {
			abort();
			return;
		}
		try {
			worker.postMessage(
				{
					words: snapshot,
					useInclination,
					pixels: image && { width: image.width, height: image.height, data: image.data }
				},
				image ? [image.data.buffer as ArrayBuffer] : []
			);
		} catch (error) {
			finish(undefined, error);
		}
	});
}
