import type { Comic } from './types/Comic';
import { baseNameExt } from './types/funcs';

/** Group image formats and language variants by page stem within their directory. */
export function groupImageVariants(images: Comic[]): Comic[] {
	const byBase = new Map<string, Comic>();
	const variants = new Set<Comic>();
	for (const image of images) {
		const [base] = baseNameExt(image.path);
		// Multiple formats for the same page/language use the first image encountered.
		if (!byBase.has(base)) byBase.set(base, image);
		else variants.add(image);
	}
	for (const [base, image] of byBase) {
		const match = /^(.*)\.([a-z]{2,3}(?:-[a-z0-9]+)*)$/i.exec(base);
		if (!match || match[2].toLowerCase() === 'org') continue;
		const original = byBase.get(match[1]);
		if (!original) continue;
		const language = match[2].toLowerCase();
		if (!original.renderedImages.has(language)) original.renderedImages.set(language, image);
		variants.add(image);
	}
	return images.filter((image) => !variants.has(image));
}

export function imageLanguages(page: Comic, languages: string[]): string[] {
	return [
		...languages,
		...[...page.renderedImages.keys()].filter(
			(language) => !languages.some((existing) => existing.toLowerCase() === language)
		)
	];
}
