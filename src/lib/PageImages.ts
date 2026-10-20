import { releaseImageUrl } from './ImageUrls';
import type { Comic } from './types/Comic';

export type PageImage = { url: string; width: number; height: number };

/** Keep only images belonging to the displayed or incoming spread. */
export class PageImages {
	private images = new Map<Comic, Promise<PageImage>>();
	private protections = new Map<Comic, () => void>();

	private protect(comic: Comic) {
		if (!this.protections.has(comic)) this.protections.set(comic, comic.protectImage());
	}

	load(comic: Comic): Promise<PageImage> {
		this.protect(comic);
		let pending = this.images.get(comic);
		if (!pending) {
			pending = comic.getImageUrl().then(async (url) => {
				try {
					const image = new Image();
					image.src = url;
					await image.decode();
					return { url, width: image.naturalWidth, height: image.naturalHeight };
				} catch (error) {
					releaseImageUrl(url);
					throw error;
				}
			});
			this.images.set(comic, pending);
			void pending.catch(() => {
				if (this.images.get(comic) === pending) this.images.delete(comic);
			});
		}
		return pending;
	}

	retain(comics: readonly Comic[]) {
		// Pin incoming data before releasing outgoing pins; URLs remain independent.
		for (const comic of comics) this.protect(comic);
		for (const [comic, release] of this.protections) {
			if (comics.includes(comic)) continue;
			release();
			this.protections.delete(comic);
		}
		for (const [comic, pending] of this.images) {
			if (comics.includes(comic)) continue;
			this.images.delete(comic);
			// A cancelled load may still finish; release its URL then as well.
			void pending.then(
				(image) => releaseImageUrl(image.url),
				() => {}
			);
		}
	}
}
