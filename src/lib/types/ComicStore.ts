import { Comic, type Bubble } from './Comic';
import { baseNameExt, resolveFile, supportedImageTypes } from './funcs';

export interface ComicStore {
	list(): Promise<Comic[]>;
	getImageUrl(c: Comic): Promise<string>;
	getBubbles(c: Comic, language?: string): Promise<Bubble[]>;
}

export interface UpdatableComicStore extends ComicStore {
	update(c: Comic): boolean;
}

export class DirectoryComicStore implements ComicStore {
	constructor(private readonly dir: FileSystemDirectoryHandle) {}

	async list(): Promise<Comic[]> {
		const comics: Comic[] = [];
		await this.listDirectory(this.dir, '', comics);
		return comics;
	}

	private async listDirectory(dir: FileSystemDirectoryHandle, prefix: string, comics: Comic[]) {
		const entries = [];
		for await (const entry of dir.values()) entries.push(entry);
		entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
		const files = entries.filter((entry): entry is FileSystemFileHandle => entry.kind === 'file');

		for (const entry of entries) {
			const path = prefix + entry.name;
			if (entry.kind === 'directory') {
				const children: Comic[] = [];
				await this.listDirectory(entry, path + '/', children);
				// Groups (including mixed folders) are collections; page-only folders are albums.
				const kind =
					children.length > 0 && children.every((child) => child.kind === 'page')
						? 'album'
						: 'collection';
				comics.push(new Comic(path + '/', [], this, kind));
				for (const child of children) comics.push(child);
			} else {
				const [base, ext] = baseNameExt(entry.name);
				if (!supportedImageTypes.includes(ext.toLowerCase())) continue;
				const languages = files.flatMap((file) => {
					if (file.name === base + '.bbl') return [''];
					if (file.name.startsWith(base + '.') && file.name.endsWith('.bbl')) {
						return [file.name.slice(base.length + 1, -4)];
					}
					return [];
				});
				comics.push(new Comic(path, languages, this));
			}
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
