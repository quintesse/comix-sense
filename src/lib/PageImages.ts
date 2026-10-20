import type { Comic } from './types/Comic';

export type PageImage = { url: string; width: number; height: number };

/** Keep only images belonging to the displayed or incoming spread. */
export class PageImages {
	private images = new Map<Comic, Promise<PageImage>>();

	load(comic: Comic): Promise<PageImage> {
		let pending = this.images.get(comic);
		if (!pending) {
			pending = comic.getImageUrl().then(async (url) => {
				try {
					const image = new Image();
					image.src = url;
					await image.decode();
					return { url, width: image.naturalWidth, height: image.naturalHeight };
				} catch (error) {
					URL.revokeObjectURL(url);
					throw error;
				}
			});
			this.images.set(comic, pending);
		}
		return pending;
	}

	retain(comics: readonly Comic[]) {
		for (const [comic, pending] of this.images) {
			if (comics.includes(comic)) continue;
			this.images.delete(comic);
			// A cancelled load may still finish; release its URL then as well.
			void pending.then(
				(image) => URL.revokeObjectURL(image.url),
				() => {}
			);
		}
	}
}
