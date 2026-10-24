import type { Bubble } from '../types/Comic';

export type FontScope = 'album' | 'page' | 'bubble';
export type Font = {
	family?: string[];
	size?: number;
	style?: 'normal' | 'italic' | 'oblique';
	weight?: number;
	lineHeight?: number;
	letterSpacing?: number;
};
export type Face = {
	family: string;
	src: string;
	style: NonNullable<Font['style']>;
	weight: number;
};
export type Page = { filename?: string; font?: Font; bubbles?: Bubble[] };
export type Document = { font?: Font; fontFaces: Face[]; pages: Page[] };

/** A collection owns diagnostics, so revisiting pages cannot flood the console. */
export class Diagnostics {
	private seen = new Set<string>();
	warn(context: string, reason: string, recovery: string) {
		const message = `[bbl] ${context}: ${reason}; ${recovery}`;
		if (!this.seen.has(message)) {
			this.seen.add(message);
			console.warn(message);
		}
	}
}

export function relativePath(value: unknown): string | undefined {
	if (typeof value !== 'string' || !value || /[\\:\x00-\x1f]/.test(value)) return;
	const parts = value.normalize('NFC').split('/');
	if (parts.some((p) => !p || p === '..')) return;
	const normalized = parts.filter((p) => p !== '.').join('/');
	return normalized || undefined;
}

export function fontSource(value: string): string | undefined {
	const extension = value.split(/[?#]/)[0];
	if (!/\.(woff2?|ttf|otf)$/i.test(extension)) return;
	if (value.startsWith('https://')) {
		try {
			if (new URL(value).protocol === 'https:') return value;
		} catch {
			return;
		}
	}
	return relativePath(value);
}

export function font(value: unknown, context: string, diagnostics: Diagnostics): Font {
	if (value === undefined) return {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		diagnostics.warn(context, 'invalid font object', 'ignore font and inherit');
		return {};
	}
	const result: Record<string, unknown> = {};
	for (const [key, v] of Object.entries(value)) {
		const finite = typeof v === 'number' && Number.isFinite(v);
		const valid =
			key === 'family'
				? Array.isArray(v) && v.length > 0 && v.every((f) => typeof f === 'string' && f.trim())
				: key === 'style'
					? ['normal', 'italic', 'oblique'].includes(v as string)
					: key === 'weight'
						? finite && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1000
						: key === 'size' || key === 'lineHeight'
							? finite && (v as number) > 0
							: key === 'letterSpacing' && finite;
		if (valid) result[key] = v;
		else
			diagnostics.warn(
				`${context}.${key}`,
				'invalid optional font property',
				'ignore property and inherit'
			);
	}
	return result as Font;
}

export function parseDocument(
	raw: unknown,
	path: string,
	index: boolean,
	diagnostics: Diagnostics
): Document {
	const doc: Document = { fontFaces: [], pages: [] };
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		diagnostics.warn(path, 'invalid document object', 'ignore document');
		return doc;
	}
	const input = raw as Record<string, any>;
	doc.font = font(input.font, `${path}.font`, diagnostics);
	if (input.fontFaces !== undefined && !Array.isArray(input.fontFaces))
		diagnostics.warn(path + '.fontFaces', 'expected array', 'ignore declarations');
	for (const [i, item] of (Array.isArray(input.fontFaces) ? input.fontFaces : []).entries()) {
		const f = item && typeof item === 'object' ? item : {};
		const style = f.style === undefined ? 'normal' : f.style;
		const weight = f.weight === undefined ? 400 : f.weight;
		const src = typeof f.src === 'string' ? f.src : '';
		const validSource = fontSource(src);
		if (
			typeof f.family !== 'string' ||
			!f.family.trim() ||
			!validSource ||
			!['normal', 'italic', 'oblique'].includes(style) ||
			!Number.isInteger(weight) ||
			weight < 1 ||
			weight > 1000
		) {
			diagnostics.warn(
				`${path}.fontFaces[${i}] (${src})`,
				'invalid face declaration',
				'skip entry'
			);
			continue;
		}
		doc.fontFaces.push({
			family: f.family,
			src: validSource,
			style,
			weight
		});
	}
	if (input.pages !== undefined && !Array.isArray(input.pages))
		diagnostics.warn(path + '.pages', 'expected array', 'ignore page records; keep defaults');
	const seen = new Set<string>();
	for (const [i, p] of (Array.isArray(input.pages) ? input.pages : []).entries()) {
		const context = `${path}.pages[${i}] (${String(p?.filename ?? '')})`;
		if (!p || typeof p !== 'object' || Array.isArray(p)) {
			diagnostics.warn(context, 'invalid page record', 'skip record');
			continue;
		}
		const filename = relativePath(p.filename);
		if ((index || p.filename !== undefined) && !filename) {
			diagnostics.warn(context, 'invalid or escaping filename', 'skip record');
			continue;
		}
		if (filename && seen.has(filename)) {
			diagnostics.warn(
				context,
				'duplicate normalized filename',
				'keep first record; skip duplicate'
			);
			continue;
		}
		if (filename) seen.add(filename);
		const page: Page = { filename, font: font(p.font, context + '.font', diagnostics) };
		if (p.bubbles !== undefined) {
			if (Array.isArray(p.bubbles))
				page.bubbles = p.bubbles.flatMap((b: any, j: number) => {
					if (
						!b ||
						typeof b.text !== 'string' ||
						!['box', 'poly'].includes(b.shape?.type) ||
						!Array.isArray(b.shape?.vs) ||
						b.shape.vs.length < 2 ||
						!b.shape.vs.every((v: any) => Number.isFinite(v?.x) && Number.isFinite(v?.y))
					) {
						diagnostics.warn(`${context}.bubbles[${j}]`, 'invalid bubble', 'skip bubble');
						return [];
					}
					return [{ ...b, font: font(b.font, `${context}.bubbles[${j}].font`, diagnostics) }];
				});
			else
				diagnostics.warn(context + '.bubbles', 'expected array', 'inherit lower-priority bubbles');
		}
		doc.pages.push(page);
	}
	return doc;
}

/** Resolve the target before considering a language suffix. Longest matching name wins. */
export function matchDocument(
	path: string,
	targets: string[],
	diagnostics: Diagnostics,
	context = path
) {
	const stem = path.slice(0, -4);
	const match = (name: string) =>
		stem === name || (stem.startsWith(name + '.') && !stem.slice(name.length + 1).includes('.'));
	const exact = targets.filter(match).sort((a, b) => b.length - a.length || a.localeCompare(b));
	if (exact.length) {
		const target = exact[0];
		return { target, language: stem === target ? '' : stem.slice(target.length + 1), exact: true };
	}
	const basename = (name: string) => name.replace(/\.[^/.]+$/, '');
	const candidates = targets.filter((name) => match(basename(name)));
	if (candidates.length === 1) {
		const target = candidates[0],
			base = basename(target);
		return { target, language: stem === base ? '' : stem.slice(base.length + 1), exact: false };
	}
	if (candidates.length > 1)
		diagnostics.warn(
			context,
			`ambiguous shorthand; candidates: ${candidates.join(', ')}`,
			'ignore document; use full target filenames'
		);
}
