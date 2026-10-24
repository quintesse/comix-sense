import type { Font, Face, FontScope } from '../bbl/metadata';
import { writable } from 'svelte/store';
import type { FontResources, ResourceFace } from '../bbl/FontResources';
import type { ComicStore } from './ComicStore';
import type { ArchivePriority } from '../archives/ArchiveReader';
import { baseNameExt, type StrStrMap } from './funcs';

export type ComicKind = 'page' | 'album' | 'collection' | 'archive';

export class Comic {
	path: string;
	/** Explicit membership for archive pages, independent of internal directories. */
	album?: string;
	entryPath?: string;
	archiveState?: string;
	languages: string[];
	readonly kind: ComicKind;
	displayName: string;
	private store: ComicStore;

	private typography = new Map<string, Map<string, Font>>();
	private fontContexts = new Map<
		string,
		{
			font: Font;
			pageFont?: Font;
			albumFont?: Font;
			pageFaces?: Face[];
			albumFaces?: Face[];
			faces: ResourceFace[];
			resources: FontResources;
		}
	>();
	private fontRevisions = new Map<string, number>();
	readonly typographyRevision = writable(0);

	private langBubbles: { [key: string]: Bubble[] } = {};
	private sourceLanguages = new Map<string, string>();

	sourceLanguage(overlay: string): string | undefined {
		return this.sourceLanguages.get(overlay);
	}

	setSourceLanguage(overlay: string, language: string | undefined): void {
		if (language) this.sourceLanguages.set(overlay, language);
		else this.sourceLanguages.delete(overlay);
	}
	private documents = new Map<string, string>();
	private targets = new Map<string, string>();
	readonly documentTargets = writable<ReadonlyMap<string, string>>(new Map());

	sourceDocument(language: string): string | undefined {
		return this.documents.get(language);
	}
	setSourceDocument(language: string, path: string | undefined, target = path) {
		if (this.documents.get(language) === path && this.targets.get(language) === target) return;
		if (path) this.documents.set(language, path);
		else this.documents.delete(language);
		if (target) this.targets.set(language, target);
		else this.targets.delete(language);
		this.documentTargets.set(new Map(this.targets));
	}

	constructor(path: string, languages: string[], store: ComicStore, kind: ComicKind = 'page') {
		this.path = path;
		this.languages = languages;
		this.store = store;
		this.kind = kind;
		const name = path.replace(/\/$/, '').split('/').at(-1)!;
		this.displayName = kind === 'page' || kind === 'archive' ? baseNameExt(name)[0] : name;
	}

	get albumPath(): string {
		return this.album ?? this.path.slice(0, this.path.lastIndexOf('/') + 1);
	}

	get fileName(): string {
		return this.path.replace(/\/$/, '').split('/').at(-1)!;
	}

	/** Rendered images are variants of this page, never separate reader pages. */
	readonly renderedImages = new Map<string, Comic>();

	hasTranslation(language: string, editingMode = false): boolean {
		const code = language.toLowerCase();
		return (
			this.renderedImages.has(code) ||
			(editingMode && this.languages.some((language) => language.toLowerCase() === code))
		);
	}

	imageForLanguage(language: string): Comic {
		return this.renderedImages.get(language.toLowerCase()) ?? this;
	}

	getImageUrl(priority: ArchivePriority = 'reader'): Promise<string> {
		return this.store.getImageUrl(this, priority);
	}

	protectImage(): () => void {
		return this.store.protectImage?.(this) ?? (() => {});
	}

	getBubbles(language?: string): Promise<Bubble[]> {
		if (language === 'org') {
			return Promise.resolve([]);
		}
		const lang = language !== undefined ? language : this.languages[0];
		if (lang in this.langBubbles) {
			return Promise.resolve(this.langBubbles[lang]);
		} else {
			return this.store.getBubbles(this, lang).then((x) => (this.langBubbles[lang] = x));
		}
	}

	async prepareTypography(
		language: string,
		overlay: {
			font: Font;
			pageFont?: Font;
			albumFont?: Font;
			pageFaces?: Face[];
			albumFaces?: Face[];
			faces: ResourceFace[];
			bubbles: Bubble[];
		},
		resources: FontResources
	) {
		this.fontContexts.set(language, {
			font: overlay.font,
			pageFont: overlay.pageFont,
			albumFont: overlay.albumFont,
			pageFaces: overlay.pageFaces,
			albumFaces: overlay.albumFaces,
			faces: overlay.faces,
			resources
		});
		await this.refreshTypography(language, overlay.bubbles);
	}

	async refreshTypography(language: string, bubbles: Pick<Bubble, 'font'>[]) {
		const context = this.fontContexts.get(language);
		if (!context) return;
		const revision = (this.fontRevisions.get(language) ?? 0) + 1;
		this.fontRevisions.set(language, revision);
		const values = new Map<string, Font>();
		const overrides = [undefined, ...bubbles.map((b) => b.font)];
		await Promise.all(
			overrides.map(async (override) => {
				values.set(
					JSON.stringify(override ?? {}),
					await context.resources.resolve({ ...context.font, ...override }, context.faces)
				);
			})
		);
		if (this.fontRevisions.get(language) === revision) {
			this.typography.set(language, values);
			this.typographyRevision.update((value) => value + 1);
		}
	}

	pageFont(language: string): Font {
		return this.fontContexts.get(language)?.pageFont ?? {};
	}
	albumFont(language: string): Font {
		return this.fontContexts.get(language)?.albumFont ?? {};
	}
	fontFaces(language: string, scope: FontScope): Face[] {
		const context = this.fontContexts.get(language);
		return scope === 'album'
			? (context?.albumFaces ?? [])
			: scope === 'page'
				? (context?.pageFaces ?? [])
				: [];
	}
	async editFontFaces(language: string, scope: FontScope, faces: Face[]): Promise<void> {
		if (scope !== 'bubble')
			await this.store.editFontFaces?.(this, language, faces, scope === 'album');
	}
	typographyLanguages(): string[] {
		return [...this.fontContexts.keys()];
	}
	async editAlbumFont(font: Font): Promise<void> {
		await this.store.editAlbumFont?.(this, font);
	}
	defaultFont(language: string): Font {
		return this.fontContexts.get(language)?.font ?? {};
	}
	fontFamilies(language: string): string[] {
		return [...new Set(this.fontContexts.get(language)?.faces.map((face) => face.family) ?? [])];
	}

	textFont(language: string, bubble: Bubble): Font {
		const values = this.typography.get(language);
		return (
			values?.get(JSON.stringify(bubble.font ?? {})) ?? { ...values?.get('{}'), ...bubble.font }
		);
	}

	// Retain the editor's reactive array when revisiting a page or language.
	// Persistence receives a plain snapshot separately through editBubbles.
	setBubbles(language: string, bubbles: Bubble[]): void {
		if (language !== 'org') this.langBubbles[language] = bubbles;
	}

	async editBubbles(language: string, bubbles: Bubble[], font?: Font): Promise<void> {
		if (language !== 'org') await this.store.editBubbles?.(this, language, bubbles, font);
	}
}

export type Bubble = {
	font?: Font;
	text: string;
	lang?: string;
	style?: StrStrMap;
	shape: BblShape;
};

export enum BblShapeType {
	box = 'box',
	poly = 'poly'
}

export type BblShape = {
	type: BblShapeType;
	vs: Vertex[];
};

export type Vertex = {
	x: number;
	y: number;
};

export function vertex(x: number, y: number): Vertex {
	return { x: x, y: y };
}

export function points(vs: Vertex[]): string {
	return vs.map((v) => v.x + ',' + v.y).join(' ');
}

export type Bounds = {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	w: number;
	h: number;
};

export function bounds(vs: Vertex[]): Bounds {
	var minX = Number.MAX_SAFE_INTEGER;
	var maxX = Number.MIN_SAFE_INTEGER;
	var minY = Number.MAX_SAFE_INTEGER;
	var maxY = Number.MIN_SAFE_INTEGER;
	for (let v of vs) {
		minX = Math.min(minX, v.x);
		maxX = Math.max(maxX, v.x);
		minY = Math.min(minY, v.y);
		maxY = Math.max(maxY, v.y);
	}
	return { x1: minX, y1: minY, x2: maxX, y2: maxY, w: maxX - minX, h: maxY - minY };
}

export function boundsv(bs: Vertex[] | Bounds): Vertex[] {
	if (Array.isArray(bs)) {
		return boundsv(bounds(bs));
	} else {
		return [vertex(bs.x1, bs.y1), vertex(bs.x2, bs.y2)];
	}
}

export function distance(v1: Vertex, v2: Vertex) {
	return Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2));
}

export function samev(v1: Vertex, v2: Vertex) {
	return v1.x === v2.x && v1.y === v2.y;
}

export function samevs(vs1: Vertex[], vs2: Vertex[]) {
	return vs1.length === vs2.length && zip(vs1, vs2).every(([v1, v2]) => samev(v1, v2));
}

export function zip(...arr: any[]) {
	return Array(Math.max(...arr.map((a) => a.length)))
		.fill(undefined)
		.map((_, i) => arr.map((a) => a[i]));
}

export abstract class Shape {
	abstract readonly type: string;
	abstract vertices(): Vertex[];
	abstract boundingBox(): Box;
	abstract poly(): Poly;

	static create(shape: BblShape): Shape {
		if (shape.type === 'box') {
			return new Box(shape);
		} else if (shape.type === 'poly') {
			return new Poly(shape);
		} else {
			throw 'Unexpected Shape type: ' + shape.type;
		}
	}
}

export class Box implements Shape {
	private shape: BblShape;

	readonly type: string = 'box';

	constructor(shape: BblShape) {
		this.shape = shape;
	}

	vertices(): Vertex[] {
		return this.shape.vs;
	}

	boundingBox(): Box {
		throw new Error('Method not implemented.');
	}

	poly(): Poly {
		throw new Error('Method not implemented.');
	}
}

export class Poly implements Shape {
	private shape: BblShape;

	readonly type: string = 'poly';

	constructor(shape: BblShape) {
		this.shape = shape;
	}

	vertices(): Vertex[] {
		return this.shape.vs;
	}

	boundingBox(): Box {
		throw new Error('Method not implemented.');
	}

	poly(): Poly {
		throw new Error('Method not implemented.');
	}
}
