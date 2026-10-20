import { ArchiveComicStore } from '../archives/ArchiveComicStore';
import type { ArchivePriority } from '../archives/ArchiveReader';
import { Comic, type Bubble } from './Comic';
import {
	baseNameExt,
	resolveFile,
	sharedFilenamePrefix,
	supportedImageTypes,
	withoutAlbumPrefix,
	withoutParentPrefix
} from './funcs';

export interface ComicStore {
	list(): Promise<Comic[]>;
	getImageUrl(c: Comic, priority?: ArchivePriority): Promise<string>;
	protectImage?(c: Comic): () => void;
	getBubbles(c: Comic, language?: string): Promise<Bubble[]>;
}

export interface UpdatableComicStore extends ComicStore {
	update(c: Comic): boolean;
}

export class DirectoryComicStore implements ComicStore {
	private archives = new Map<string, ArchiveComicStore>();
	private disposed = false;
	constructor(private readonly dir: FileSystemDirectoryHandle) {}

	archive(path: string): ArchiveComicStore {
		if (this.disposed) throw new Error('Directory disconnected');
		let store = this.archives.get(path);
		if (!store) {
			store = new ArchiveComicStore(
				path,
				async () => (await resolveFile(this.dir, path)).getFile(),
				path.split('/').at(-2) ?? this.dir.name
			);
			this.archives.set(path, store);
		}
		return store;
	}
	cancelArchives(except?: string) {
		for (const [path, store] of this.archives) if (path !== except) store.cancel();
	}
	dispose() {
		this.disposed = true;
		for (const store of this.archives.values()) store.dispose();
		this.archives.clear();
	}
	async list(): Promise<Comic[]> {
		const comics: Comic[] = [];
		await this.listDirectory(this.dir, '', comics);
		return comics;
	}

	private async listDirectory(
		dir: FileSystemDirectoryHandle,
		prefix: string,
		comics: Comic[],
		collection = ''
	) {
		const pages: Comic[] = [];
		const entries = [];
		for await (const entry of dir.values()) entries.push(entry);
		entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
		const files = entries.filter((entry): entry is FileSystemFileHandle => entry.kind === 'file');

		for (const entry of entries) {
			const path = prefix + entry.name;
			if (entry.kind === 'directory') {
				const children: Comic[] = [];
				await this.listDirectory(entry, path + '/', children, dir.name);
				// Groups (including mixed folders) are collections; page-only folders are albums.
				const kind =
					children.length > 0 && children.every((child) => child.kind === 'page')
						? 'album'
						: 'collection';
				const folder = new Comic(path + '/', [], this, kind);
				folder.displayName = withoutParentPrefix(entry.name, dir.name);
				comics.push(folder);
				for (const child of children) comics.push(child);
			} else {
				const [base, ext] = baseNameExt(entry.name);
				if (['cbr', 'cbz', 'zip'].includes(ext.toLowerCase())) {
					const archive = new Comic(path, [], this, 'archive');
					archive.displayName = withoutParentPrefix(base, dir.name);
					comics.push(archive);
					continue;
				}
				if (!supportedImageTypes.includes(ext.toLowerCase())) continue;
				const languages = files.flatMap((file) => {
					if (file.name === base + '.bbl') return [''];
					if (file.name.startsWith(base + '.') && file.name.endsWith('.bbl')) {
						return [file.name.slice(base.length + 1, -4)];
					}
					return [];
				});
				const page = new Comic(path, languages, this);
				page.displayName = withoutAlbumPrefix(page.displayName, collection, dir.name);
				pages.push(page);
				comics.push(page);
			}
		}
		const sharedPrefix = sharedFilenamePrefix(pages.map((page) => page.displayName));
		if (sharedPrefix) {
			for (const page of pages) page.displayName = page.displayName.slice(sharedPrefix.length);
		}
	}

	async getImageUrl(comic: Comic): Promise<string> {
		const handle = await resolveFile(this.dir, comic.path);
		return URL.createObjectURL(await handle.getFile());
	}

	async getBubbles(comic: Comic, language?: string): Promise<Bubble[]> {
		const lang = language ?? comic.languages[0];
		if (lang === undefined) return [];
		const path = baseNameExt(comic.path)[0] + (lang ? '.' + lang : '') + '.bbl';
		try {
			const handle = await resolveFile(this.dir, path);
			const json = JSON.parse(await (await handle.getFile()).text());
			if (!Array.isArray(json.pages?.[0]?.bubbles)) throw new Error('Invalid bubble data');
			return json.pages[0].bubbles;
		} catch (error) {
			// A language may exist on another page in this collection.
			if (error instanceof DOMException && error.name === 'NotFoundError') return [];
			throw new Error('Could not read bubbles: ' + path, { cause: error });
		}
	}
}
