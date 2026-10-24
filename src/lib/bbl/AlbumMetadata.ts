import type { Bubble } from '../types/Comic';
import type { BblWorkspace } from './BblWorkspace';
import { FontResources, type ResourceFace } from './FontResources';
import {
	Diagnostics,
	matchDocument,
	parseDocument,
	relativePath,
	type Document,
	type Page,
	type Font,
	type Face
} from './metadata';

export type Source = {
	path: string;
	language: string;
	exact?: boolean;
	read: () => Promise<string>;
};
type Loaded = Source & { data: Document };

/** Bubble arrays and font cascades deliberately follow independent precedence rules. */
export class AlbumMetadata {
	readonly diagnostics: Diagnostics;
	readonly fonts: FontResources;
	private internal: Loaded[] = [];
	private adjacent: Loaded[] = [];
	private companion: Loaded[] = [];
	private sidecars = new Map<string, Map<string, Source>>();
	private documents = new Map<string, Promise<Document>>();
	private rawDocuments = new Map<string, Record<string, any>>();
	constructor(
		private read: (path: string) => Promise<Blob>,
		diagnostics = new Diagnostics(),
		private context = '',
		private workspace?: BblWorkspace,
		private archiveOutput?: string
	) {
		this.diagnostics = diagnostics;
		this.fonts = new FontResources(diagnostics);
	}
	private load(source: Source, index: boolean) {
		let pending = this.documents.get(source.path);
		if (!pending) {
			pending = (this.workspace?.read(source.path, source.read) ?? source.read()).then((text) => {
				let raw: unknown;
				try {
					raw = JSON.parse(text);
				} catch (error) {
					if (!index) throw new Error('Could not read bubbles: ' + source.path, { cause: error });
					this.diagnostics.warn(
						source.path,
						String(error),
						'ignore malformed index; continue with sidecars and images'
					);
				}
				if (raw && typeof raw === 'object' && !Array.isArray(raw))
					this.rawDocuments.set(source.path, raw as Record<string, any>);
				return parseDocument(raw ?? {}, source.path, index, this.diagnostics);
			});
			this.documents.set(source.path, pending);
			void pending.catch(() => this.documents.delete(source.path));
		}
		return pending;
	}
	async discover(
		paths: string[],
		images: string[],
		adjacent: Source[] = [],
		overrides: Source[] = []
	) {
		const imagePaths = new Set(images.map((path) => path.normalize('NFC')));
		const loadIndex = async (source: Source) => {
			const data = await this.load(source, true);
			data.pages = data.pages.filter((page) => {
				if (imagePaths.has(page.filename!)) return true;
				this.diagnostics.warn(
					`${source.path} page ${page.filename}`,
					'filename does not match a discovered image',
					'skip page record; keep defaults'
				);
				return false;
			});
			return { ...source, data };
		};
		for (const path of paths.filter((p) => p.endsWith('.bbl')).sort()) {
			const internal = /^album(?:\.([^.\/]+))?\.bbl$/.exec(path);
			const source = {
				path: this.context + path,
				language: internal?.[1] ?? '',
				read: async () => (await this.read(path)).text()
			};
			if (internal) {
				this.internal.push(await loadIndex(source));
				continue;
			}
			const match = matchDocument(path, images, this.diagnostics, this.context + path);
			if (!match) continue;
			const target = match.target.normalize('NFC');
			const byLanguage = this.sidecars.get(target) ?? new Map<string, Source>();
			const existing = byLanguage.get(match.language);
			if (!existing || (!existing.exact && match.exact))
				byLanguage.set(match.language, { ...source, ...match });
			this.sidecars.set(target, byLanguage);
		}
		const selected = new Map<string, Source>();
		for (const source of [...adjacent].sort((a, b) => a.path.localeCompare(b.path))) {
			const existing = selected.get(source.language);
			if (!existing || (!existing.exact && source.exact)) selected.set(source.language, source);
		}
		for (const source of selected.values()) this.adjacent.push(await loadIndex(source));
		// Loose .bbl sidecars for archive pages have the same format and parsing path.
		const external = new Map<string, Map<string, Source>>();
		for (const source of [...overrides].sort((a, b) => a.path.localeCompare(b.path))) {
			const path = source.path.slice((this.archiveOutput! + '.bbl/').length);
			const index = /^album(?:\.([^.\/]+))?\.bbl$/.exec(path);
			if (index) {
				this.companion.push(await loadIndex({ ...source, language: index[1] ?? '' }));
				continue;
			}
			const match = matchDocument(path, images, this.diagnostics, source.path);
			if (!match) continue;
			const target = match.target.normalize('NFC');
			const byLanguage = external.get(target) ?? new Map<string, Source>();
			const existing = byLanguage.get(match.language);
			if (!existing || (!existing.exact && match.exact))
				byLanguage.set(match.language, { ...source, ...match });
			external.set(target, byLanguage);
		}
		for (const [target, byLanguage] of external)
			this.sidecars.set(target, new Map([...(this.sidecars.get(target) ?? []), ...byLanguage]));
	}
	languages(filename: string) {
		filename = filename.normalize('NFC');
		const languages = [...(this.sidecars.get(filename)?.keys() ?? [])];
		for (const [language, source] of this.sidecars.get(filename) ?? [])
			this.workspace?.associatePage(this.writePath(source.path), this.context + filename, language);
		for (const doc of [...this.internal, ...this.adjacent, ...this.companion])
			if (doc.data.pages.some((p) => p.filename === filename && p.bubbles !== undefined)) {
				languages.push(doc.language);
				this.workspace?.associatePage(
					this.writePath(doc.path),
					this.context + filename,
					doc.language
				);
			}
		return [...new Set(languages)];
	}
	private albumDocument() {
		return (
			this.companion.find((doc) => doc.path.endsWith('/album.bbl') && doc.language === '') ??
			this.internal.find((doc) => doc.language === '')
		);
	}
	async editAlbumFont(font?: Font, faces?: Face[]) {
		if (!this.workspace) return;
		let document = this.albumDocument();
		const source =
			document?.path ??
			(this.archiveOutput ? this.archiveOutput + '.bbl/' : this.context) + 'album.bbl';
		const raw = this.rawDocuments.get(source) ?? { pages: [] };
		this.workspace.editAlbum(
			this.writePath(source),
			raw,
			font,
			this.archiveOutput ?? this.context,
			source,
			faces
		);
		if (!document) {
			document = {
				path: source,
				language: '',
				read: async () => JSON.stringify(raw),
				data: parseDocument(raw, source, true, this.diagnostics)
			};
			(this.archiveOutput ? this.companion : this.internal).push(document);
			this.rawDocuments.set(source, raw);
		}
		if (font !== undefined) {
			document.data.font = structuredClone(font);
			raw.font = structuredClone(font);
		}
		if (faces !== undefined) {
			document.data.fontFaces = structuredClone(faces);
			raw.fontFaces = structuredClone(faces);
		}
	}
	async editPageFaces(filename: string, language: string, faces: Face[]) {
		if (!this.workspace) return;
		filename = filename.normalize('NFC');
		const sidecar = this.sidecars.get(filename)?.get(language);
		if (sidecar) await this.load(sidecar, false);
		const source =
			sidecar?.path ??
			(this.archiveOutput ? this.archiveOutput + '.bbl/' : this.context) +
				filename +
				(language ? '.' + language : '') +
				'.bbl';
		const raw = this.rawDocuments.get(source) ?? { pages: [] };
		this.workspace.editFaces(
			this.writePath(source),
			raw,
			faces,
			this.context + filename,
			language,
			source
		);
		raw.fontFaces = structuredClone(faces);
		const data = sidecar
			? await this.load(sidecar, false)
			: parseDocument(raw, source, false, this.diagnostics);
		data.fontFaces = structuredClone(faces);
		this.rawDocuments.set(source, raw);
		this.documents.set(source, Promise.resolve(data));
		const languages = this.sidecars.get(filename) ?? new Map<string, Source>();
		languages.set(
			language,
			sidecar ?? { path: source, language, exact: true, read: async () => JSON.stringify(raw) }
		);
		this.sidecars.set(filename, languages);
	}
	async overlay(filename: string, language: string) {
		filename = filename.normalize('NFC');
		let bubbles: Bubble[] = [];
		let sourceLanguage: string | undefined;
		let font: Font = {};
		const faces = new Map<string, ResourceFace>();
		let document:
			{ path: string; raw: Record<string, any>; pageIndex: number; page: Page } | undefined;
		const apply = (doc: Loaded, sidecar = false) => {
			const page =
				doc.data.pages.find((p) => p.filename === filename) ??
				(sidecar ? doc.data.pages.find((p) => !p.filename) : undefined);
			font = { ...font, ...doc.data.font, ...page?.font };
			for (const face of doc.data.fontFaces)
				faces.set(JSON.stringify([face.family.toLowerCase(), face.style, face.weight]), {
					...face,
					document: doc.path,
					read: this.read
				});
			if (page?.bubbles !== undefined && doc.language === language) {
				bubbles = page.bubbles;
				const raw = this.rawDocuments.get(doc.path)!;
				const pageIndex = raw.pages.findIndex(
					(p: any) =>
						p &&
						typeof p === 'object' &&
						!Array.isArray(p) &&
						(page.filename ? relativePath(p.filename) === page.filename : !p.filename)
				);
				document = { path: doc.path, raw, pageIndex, page };
				const declared = raw.pages[pageIndex]?.lang ?? raw.lang;
				sourceLanguage = typeof declared === 'string' ? declared : undefined;
			}
		};
		for (const location of [this.internal, this.adjacent]) {
			for (const lang of [...new Set(['', language])])
				for (const doc of location) if (doc.language === lang) apply(doc);
		}
		const sidecar = this.sidecars.get(filename)?.get(language);
		const companionSidecar = sidecar?.path.startsWith(this.archiveOutput + '.bbl/');
		if (sidecar && !companionSidecar)
			apply({ ...sidecar, data: await this.load(sidecar, false) }, true);
		for (const lang of [...new Set(['', language])])
			for (const doc of this.companion) if (doc.language === lang) apply(doc);
		if (sidecar && companionSidecar)
			apply({ ...sidecar, data: await this.load(sidecar, false) }, true);
		return {
			bubbles,
			font,
			pageFont: document?.page.font ?? {},
			albumFont: this.albumDocument()?.data.font ?? {},
			albumFaces: this.albumDocument()?.data.fontFaces ?? [],
			pageFaces: sidecar ? (await this.load(sidecar, false)).fontFaces : [],
			faces: [...faces.values()],
			document,
			sourceLanguage
		};
	}

	writePath(source: string): string {
		return this.archiveOutput && source.startsWith(this.context)
			? this.archiveOutput + '.bbl/' + source.slice(this.context.length)
			: source;
	}

	async edit(filename: string, language: string, bubbles: Bubble[], font?: Font) {
		if (!this.workspace) return;
		const overlay = await this.overlay(filename, language);
		const suffix = language ? '.' + language : '';
		const prefix = this.archiveOutput ? this.archiveOutput + '.bbl/' : this.context;
		const document = overlay.document ?? {
			path: prefix + filename.replace(/\.[^/.]+$/, '') + suffix + '.bbl',
			raw: { pages: [{ filename, bubbles: [] }] },
			pageIndex: 0,
			page: { filename, bubbles: [] } as Page
		};
		const path = this.writePath(document.path);
		this.workspace.edit(
			path,
			document.raw,
			document.pageIndex,
			bubbles,
			this.context + filename,
			language,
			document.path,
			font
		);
		if (font !== undefined) {
			// Keep the in-memory cascade in sync with the draft for immediate preview.
			document.page.font = structuredClone(font);
			document.raw.pages[document.pageIndex].font = structuredClone(font);
		}
		return { path, source: document.path };
	}
	dispose() {
		this.fonts.dispose();
		this.documents.clear();
		this.rawDocuments.clear();
	}
}
