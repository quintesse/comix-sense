import type { DirectoryComicStore } from './ComicStore';
import type { Comic } from './Comic';
import type { SidebarDirectory } from '../stores/SidebarSession';

export interface ComicFolder extends SidebarDirectory {
	comics: Comic[];
	store: DirectoryComicStore;
	albumPages: Record<string, string>;
}

export function comicNodeId(folder: ComicFolder, comic: Comic): string {
	return `${folder.id}/${comic.path}`;
}
