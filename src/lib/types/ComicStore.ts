import { AlbumMetadata, type Source } from '../bbl/AlbumMetadata';
import { BblWorkspace } from '../bbl/BblWorkspace';
import { Diagnostics, matchDocument } from '../bbl/metadata';
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
	editBubbles?(c: Comic, language: string, bubbles: Bubble[]): Promise<void>;
}

export interface UpdatableComicStore extends ComicStore {
	update(c: Comic): boolean;
}

export class DirectoryComicStore implements ComicStore {
	private archives = new Map<string, ArchiveComicStore>();
	private disposed = false;
	private metadata = new Map<string, AlbumMetadata>();
	private pageMetadata = new Map<string, { album: AlbumMetadata; filename: string }>();
	private files = new Set<string>();
	private directories = new Map<string, string[]>();
	private pageSidecars = new Set<string>();
	private adjacent = new Map<string, Source[]>();
	private diagnostics = new Diagnostics();
	readonly workspace: BblWorkspace;
	constructor(private readonly dir: FileSystemDirectoryHandle) {
		this.workspace = new BblWorkspace(dir);
	}

	archive(path: string): ArchiveComicStore {
		if (this.disposed) throw new Error('Directory disconnected');
		let store = this.archives.get(path);
		if (!store) {
			const paths = new Set([...this.files, ...this.workspace.paths()]);
			const overrides = [...paths]
				.filter((name) => name.startsWith(path + '.bbl/') && name.endsWith('.bbl'))
				.map((name) => ({
					path: name,
					language: '',
					read: async () => (await (await resolveFile(this.dir, name)).getFile()).text()
				}));
			store = new ArchiveComicStore(
				path,
				async () => (await resolveFile(this.dir, path)).getFile(),
				path.split('/').at(-2) ?? this.dir.name,
				this.adjacent.get(path) ?? [],
				this.workspace,
				overrides
			);
			this.archives.set(path, store);
		}
		return store;
	}
	cancelArchives(except?: string) {
		for (const [path, store] of this.archives) if (path !== except) store.cancel();
	}
	dispose() {
		this.workspace.dispose();
		this.disposed = true;
		for (const store of this.archives.values()) store.dispose();
		this.archives.clear();
		for (const album of this.metadata.values()) album.dispose();
		this.metadata.clear();
		this.pageMetadata.clear();
	}
	async list(): Promise<Comic[]> {
		await this.workspace.restore();
		const comics: Comic[] = [];
		await this.listDirectory(this.dir, '', comics);
		await this.discoverMetadata(comics);
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
		for (const entry of entries) if (entry.kind === 'file') this.files.add(prefix + entry.name);
		this.directories.set(
			prefix,
			entries.map((entry) => entry.name)
		);

		for (const entry of entries) {
			const path = prefix + entry.name;
			if (entry.kind === 'directory') {
				// Archive override folders contain metadata, not a second visible collection.
				if (/\.(cbz|zip|cbr)\.bbl$/i.test(entry.name) && this.files.has(path.slice(0, -4))) {
					await this.listDirectory(entry, path + '/', [], dir.name);
					continue;
				}
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
				const page = new Comic(path, [], this);
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

	private async discoverMetadata(comics: Comic[]) {
		const read = async (path: string) => (await resolveFile(this.dir, path)).getFile();
		// Browser documents participate in the same discovery and precedence as disk files.
		for (const path of this.workspace.paths()) {
			const slash = path.lastIndexOf('/') + 1;
			const names = this.directories.get(path.slice(0, slash));
			if (names && !names.includes(path.slice(slash))) names.push(path.slice(slash));
			if (names) this.files.add(path);
		}
		for (const [prefix, names] of this.directories) {
			const targets = comics
				.filter(
					(c) =>
						c.path.replace(/\/$/, '').slice(0, c.path.replace(/\/$/, '').lastIndexOf('/') + 1) ===
						prefix
				)
				.map((c) => c.fileName);
			for (const name of names
				.filter((n) => n.endsWith('.bbl') && this.files.has(prefix + n))
				.sort()) {
				// Reserved internal index names belong to the containing album.
				if (/^album(?:\.[^.]+)?\.bbl$/.test(name)) continue;
				const match = matchDocument(name, targets, this.diagnostics, prefix + name);
				if (!match) continue;
				const target = comics.find((c) => c.path.replace(/\/$/, '') === prefix + match.target);
				if (target?.kind === 'page') {
					this.pageSidecars.add(prefix + name);
					continue;
				}
				const sources = this.adjacent.get(prefix + match.target) ?? [];
				sources.push({
					path: prefix + name,
					language: match.language,
					exact: match.exact,
					read: async () => (await read(prefix + name)).text()
				});
				this.adjacent.set(prefix + match.target, sources);
			}
		}
		const indexed = [...this.directories]
			.filter(
				([prefix, names]) =>
					names.some((n) => this.files.has(prefix + n) && /^album(?:\.[^.]+)?\.bbl$/.test(n)) ||
					this.adjacent.has(prefix.replace(/\/$/, ''))
			)
			.map(([prefix]) => prefix);
		const groups = new Map<string, Comic[]>();
		for (const page of comics.filter((c) => c.kind === 'page')) {
			const parent = page.path.slice(0, page.path.lastIndexOf('/') + 1);
			const root =
				indexed
					.filter((prefix) => page.path.startsWith(prefix))
					.sort((a, b) => b.length - a.length)[0] ?? parent;
			const pages = groups.get(root) ?? [];
			pages.push(page);
			groups.set(root, pages);
		}
		for (const [root, pages] of groups) {
			if (this.disposed) throw new Error('Directory disconnected');
			const album = new AlbumMetadata(
				(path) => read(root + path),
				this.diagnostics,
				root,
				this.workspace
			);
			this.metadata.set(root, album);
			const paths = [...this.directories]
				.filter(([prefix]) => prefix.startsWith(root))
				.flatMap(([prefix, names]) =>
					names
						.filter(
							(name) =>
								!name.endsWith('.bbl') ||
								this.pageSidecars.has(prefix + name) ||
								(prefix === root &&
									this.files.has(prefix + name) &&
									/^album(?:\.[^.]+)?\.bbl$/.test(name))
						)
						.map((name) => prefix.slice(root.length) + name)
				);
			await album.discover(
				paths,
				pages.map((p) => p.path.slice(root.length)),
				this.adjacent.get(root.replace(/\/$/, ''))
			);
			if (this.disposed) {
				album.dispose();
				throw new Error('Directory disconnected');
			}
			for (const page of pages) {
				const filename = page.path.slice(root.length);
				page.languages = album.languages(filename);
				this.pageMetadata.set(page.path, { album, filename });
			}
		}
	}

	async getBubbles(comic: Comic, language?: string): Promise<Bubble[]> {
		const entry = this.pageMetadata.get(comic.path);
		if (!entry) return [];
		const lang = language ?? comic.languages[0] ?? '';
		const overlay = await entry.album.overlay(entry.filename, lang);
		comic.setSourceDocument(
			lang,
			overlay.document?.path,
			overlay.document && entry.album.writePath(overlay.document.path)
		);
		await comic.prepareTypography(lang, overlay, entry.album.fonts);
		return overlay.bubbles;
	}

	async editBubbles(comic: Comic, language: string, bubbles: Bubble[]) {
		const entry = this.pageMetadata.get(comic.path);
		try {
			const document = await entry?.album.edit(entry.filename, language, bubbles);
			comic.setSourceDocument(language, document?.source, document?.path);
		} catch (error) {
			this.workspace.error.set('Could not retain edits: ' + String(error));
			throw error;
		}
	}
}
