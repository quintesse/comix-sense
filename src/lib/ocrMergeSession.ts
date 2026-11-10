import type { Bubble } from './types/Comic';
import { canAnalyzeOcrPixels } from './ocr';

// Reading a saved BBL supplies an empty font object when the word had no font.
function snapshot(bubbles: Bubble[]) {
	return JSON.stringify(bubbles, (key, value) =>
		key === 'font' && value && !Object.keys(value).length ? undefined : value
	);
}

/** Keep repeat comparisons on the same input until the user edits the OCR overlay. */
export class OcrMergeSession {
	private directories = new WeakMap<
		FileSystemDirectoryHandle,
		Map<string, { words: string; output: string }>
	>();

	input(directory: FileSystemDirectoryHandle, path: string, current: Bubble[]): Bubble[] {
		const saved = this.directories.get(directory)?.get(path);
		return saved && saved.output === snapshot(current) ? JSON.parse(saved.words) : current;
	}

	record(directory: FileSystemDirectoryHandle, path: string, words: Bubble[], merged: Bubble[]) {
		let pages = this.directories.get(directory);
		if (!pages) {
			pages = new Map();
			this.directories.set(directory, pages);
		}
		pages.set(path, { words: JSON.stringify(words), output: snapshot(merged) });
	}

	forget(directory: FileSystemDirectoryHandle, path: string) {
		this.directories.get(directory)?.delete(path);
	}
}

export async function readOcrPixels(url: string): Promise<ImageData | undefined> {
	const image = new Image();
	image.src = url;
	await image.decode();
	if (!canAnalyzeOcrPixels(image.naturalWidth, image.naturalHeight)) return;
	const canvas = document.createElement('canvas');
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return;
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(image, 0, 0);
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
