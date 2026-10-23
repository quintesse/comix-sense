import { test, expect } from '@playwright/test';
import { groupImageVariants, imageLanguages } from '../src/lib/ImageVariants';
import { Comic } from '../src/lib/types/Comic';
import type { ComicStore } from '../src/lib/types/ComicStore';

const store: ComicStore = {
	list: async () => [],
	getImageUrl: async () => '',
	getBubbles: async () => []
};
const page = (path: string) => new Comic(path, [], store);

test('collapse mixed formats and language codes into one Unicode page, choosing the first image', () => {
	const original = page('album/11 ßalou.jpg');
	const english = page('album/11 ßalou.en.png');
	const french = page('album/11 ßalou.fr.webp');
	const duplicateEnglish = page('album/11 ßalou.en.jpg');
	const duplicateOriginal = page('album/11 ßalou.webp');
	expect(
		groupImageVariants([english, original, french, duplicateEnglish, duplicateOriginal])
	).toEqual([original]);
	expect(original.displayName).toBe('11 ßalou');
	expect(original.imageForLanguage('org')).toBe(original);
	expect(original.imageForLanguage('EN')).toBe(english);
	expect(original.imageForLanguage('fr')).toBe(french);
	expect(original.imageForLanguage('nl')).toBe(original);
	expect(imageLanguages(original, ['nl', 'en'])).toEqual(['nl', 'en', 'fr']);
});

test('image grouping stays within a directory and retains images without a matching original', () => {
	const original = page('one/page01.jpg');
	const other = page('two/page01.en.png');
	const second = page('one/page02.jpg');
	const french = page('one/page02.FR.webp');
	expect(groupImageVariants([original, other, second, french])).toEqual([original, other, second]);
	expect(original.imageForLanguage('en')).toBe(original);
	expect(second.imageForLanguage('FR')).toBe(french);
	expect(imageLanguages(second, ['fr', 'nl'])).toEqual(['fr', 'nl']);
});
