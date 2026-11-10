import { mergeOcrBubbles, type OcrPixels } from './ocr';
import type { Bubble } from './types/Comic';

type Request = { words: Bubble[]; pixels?: OcrPixels; useInclination: boolean };
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<Request>) => void) | null;
	postMessage: (message: { bubbles: Bubble[] } | { error: string }) => void;
};
scope.onmessage = ({ data }) => {
	try {
		scope.postMessage({ bubbles: mergeOcrBubbles(data.words, data.pixels, data.useInclination) });
	} catch (error) {
		scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
	}
};
