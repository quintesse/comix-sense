import type { Comic } from '$lib/types/Comic';
import { dirFileName } from '$lib/types/funcs';
import { derived, type Readable } from 'svelte/store';

/**
 * This is a derived store that takes the entire collection
 * of Comics and the currently selected Comic and returns
 * all the Comics that belong to the same "collection" as
 * the selected Comic. Comics are considered part of a
 * collection when they all share the same parent path.
 */
export function collectionStore(comics: Readable<Comic[]>, comic: Readable<Comic|null>) {
	let oldSelectedComic: Comic | null = null;

	return derived([comics, comic], ([$comics, $comic], set: (value: Comic[]) => void) => {
		if ($comic !== oldSelectedComic) {
			if ($comic) {
				let [comicParentPath,] =  dirFileName($comic.path);
				if (comicParentPath != "") comicParentPath += "/";
				set($comics.filter(c => c.path !== comicParentPath && c.path.startsWith(comicParentPath)));
			} else {
				set([]);
			}
			oldSelectedComic = $comic;
		}

		return () => {
			// cleanup
		};
	}, []);
}
