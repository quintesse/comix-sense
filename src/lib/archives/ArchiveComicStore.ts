import { archiveImageUrl } from '../ImageUrls';
import { Comic, type Bubble } from '../types/Comic';
import type { ComicStore } from '../types/ComicStore';
import {
	baseNameExt,
	sharedFilenamePrefix,
	supportedImageTypes,
	withoutAlbumPrefix
} from '../types/funcs';
import { LocalArchiveReader } from './LocalArchiveReader';
import type { ArchivePriority } from './ArchiveReader';

/** Physical archive path is retained by the directory store; virtual paths never reach resolveFile. */
export class ArchiveComicStore implements ComicStore {
	private reader?: LocalArchiveReader;
	private entries = new Set<string>();
	private pages?: Comic[];
	private pending?: Promise<Comic[]>;
	private disposed = false;
	readonly prefix: string;
	constructor(
		readonly archivePath: string,
		private file: () => Promise<File>,
		private collectionName = archivePath.split('/').at(-2) ?? ''
	) {
		// The slash after an archive filename cannot collide with a physical directory.
		this.prefix = archivePath + '/';
	}
	list(): Promise<Comic[]> {
		if (this.disposed) return Promise.reject(new Error('Archive disconnected'));
		if (this.pages) return Promise.resolve(this.pages);
		return (this.pending ??= this.index().catch((error) => {
			this.pending = undefined;
			this.reader?.dispose();
			this.reader = undefined;
			throw error;
		}));
	}
	private async index() {
		const file = await this.file();
		if (this.disposed) throw new Error('Archive disconnected');
		this.reader = new LocalArchiveReader(file);
		const entries = await this.reader.list();
		if (this.disposed) throw new Error('Archive disconnected');
		this.entries = new Set(entries.map((e) => e.path));
		const pages = entries
			.filter((e) => supportedImageTypes.includes(baseNameExt(e.path)[1].toLowerCase()))
			.sort(
				(a, b) =>
					a.path.localeCompare(b.path, 'en', { numeric: true }) ||
					a.path.localeCompare(b.path, 'en')
			)
			.map((entry) => {
				const base = baseNameExt(entry.path)[0];
				const languages = entries.flatMap((e) =>
					e.path === base + '.bbl'
						? ['']
						: e.path.startsWith(base + '.') &&
							  e.path.endsWith('.bbl') &&
							  !e.path.slice(base.length + 1).includes('/')
							? [e.path.slice(base.length + 1, -4)]
							: []
				);
				const page = new Comic(this.prefix + entry.path, languages, this);
				page.album = this.archivePath;
				page.entryPath = entry.path;
				const parts = entry.path.split('/');
				const [filename, extension] = baseNameExt(parts.pop()!);
				const album = baseNameExt(this.archivePath.split('/').at(-1)!)[0];
				parts.push(withoutAlbumPrefix(filename, this.collectionName, album) + '.' + extension);
				page.displayName = withoutAlbumPrefix(parts.join('/'), this.collectionName, album);
				return page;
			});
		if (!pages.length) throw new Error('Archive contains no supported images');
		// Archives often wrap every page in the album's directory. Include that
		// virtual directory in the shared-prefix rule used for folder albums.
		const sharedPrefix = sharedFilenamePrefix(
			pages.map((page) => baseNameExt(page.displayName)[0])
		);
		if (sharedPrefix) {
			for (const page of pages) page.displayName = page.displayName.slice(sharedPrefix.length);
		}
		return (this.pages = pages);
	}
	protectImage(comic: Comic) {
		return this.reader!.protect(comic.entryPath!);
	}
	async getImageUrl(comic: Comic, priority: ArchivePriority = 'reader') {
		const blob = await this.reader!.read(comic.entryPath!, priority);
		// Limit the renderer to supported raster MIME types; never render archive HTML/SVG.
		const ext = baseNameExt(comic.entryPath!)[1].toLowerCase();
		const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
		const starts = (values: number[]) => values.every((v, i) => head[i] === v);
		const raster =
			ext === 'png'
				? starts([137, 80, 78, 71, 13, 10, 26, 10])
				: ['jpg', 'jpeg'].includes(ext)
					? starts([255, 216, 255])
					: ext === 'gif'
						? starts([71, 73, 70, 56])
						: ext === 'bmp'
							? starts([66, 77])
							: ext === 'webp'
								? starts([82, 73, 70, 70]) &&
									head[8] === 87 &&
									head[9] === 69 &&
									head[10] === 66 &&
									head[11] === 80
								: false;
		if (!raster) throw new Error('Invalid raster image: ' + comic.entryPath);
		return archiveImageUrl(blob, 'image/' + (ext === 'jpg' ? 'jpeg' : ext));
	}
	async getBubbles(comic: Comic, language?: string): Promise<Bubble[]> {
		const lang = language ?? comic.languages[0];
		if (lang === undefined) return [];
		const path = baseNameExt(comic.entryPath!)[0] + (lang ? '.' + lang : '') + '.bbl';
		if (!this.entries.has(path)) return [];
		try {
			const json = JSON.parse(await (await this.reader!.read(path)).text());
			if (!Array.isArray(json.pages?.[0]?.bubbles)) throw new Error('Invalid bubble data');
			return json.pages[0].bubbles;
		} catch (error) {
			throw new Error('Could not read bubbles: ' + path, { cause: error });
		}
	}
	cancel() {
		this.reader?.cancel();
	}
	dispose() {
		this.disposed = true;
		this.reader?.dispose();
		this.entries.clear();
		this.pages = undefined;
	}
}
