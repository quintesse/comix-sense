import type { Diagnostics, Face, Font } from './metadata';

export type ResourceFace = Face & { document: string; read: (path: string) => Promise<Blob> };
let nextAlias = 0;
const generic = new Set([
	'serif',
	'sans-serif',
	'monospace',
	'cursive',
	'fantasy',
	'system-ui',
	'ui-serif',
	'ui-sans-serif',
	'ui-monospace',
	'ui-rounded',
	'emoji',
	'math',
	'fangsong'
]);
export const cssFamily = (family: string) =>
	generic.has(family.toLowerCase()) ? family : JSON.stringify(family);

/** Registrations belong to one album. No object URLs or system installation are needed. */
export class FontResources {
	private loads = new Map<string, Promise<string | undefined>>();
	private registered = new Set<FontFace>();
	private controllers = new Set<AbortController>();
	private disposed = false;
	constructor(
		private diagnostics: Diagnostics,
		private timeoutMs = 5000
	) {}
	private load(face: ResourceFace): Promise<string | undefined> {
		if (this.disposed) return Promise.resolve(undefined);
		const key = JSON.stringify([face.document, face.family, face.style, face.weight, face.src]);
		let pending = this.loads.get(key);
		if (pending) return pending;
		pending = (async () => {
			const alias = `bbl-face-${++nextAlias}`;
			const controller = new AbortController();
			this.controllers.add(controller);
			let expired = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const work = (async () => {
					const blob = face.src.startsWith('https://')
						? await fetch(face.src, { mode: 'cors', signal: controller.signal }).then((r) => {
								if (!r.ok) throw new Error(`HTTP ${r.status}`);
								return r.blob();
							})
						: await face.read(face.src);
					if (expired || this.disposed) throw new Error('font load abandoned');
					const loaded = await new FontFace(alias, await blob.arrayBuffer(), {
						style: face.style,
						weight: String(face.weight)
					}).load();
					if (expired || this.disposed) throw new Error('font load abandoned');
					document.fonts.add(loaded);
					this.registered.add(loaded);
					return alias;
				})();
				return await Promise.race([
					work,
					new Promise<never>((_, reject) => {
						timer = setTimeout(() => {
							expired = true;
							controller.abort();
							reject(new Error('font load timed out'));
						}, this.timeoutMs);
					})
				]);
			} catch (error) {
				if (!this.disposed)
					this.diagnostics.warn(
						`${face.document} font ${face.family} (${face.src})`,
						String(error),
						'use next fallback family'
					);
				return undefined;
			} finally {
				clearTimeout(timer);
				this.controllers.delete(controller);
			}
		})();
		this.loads.set(key, pending);
		return pending;
	}
	async resolve(font: Font, faces: ResourceFace[]): Promise<Font> {
		if (!font.family) return { ...font };
		const family = await Promise.all(
			font.family.map(async (name) => {
				const declared = faces.filter((face) => face.family.toLowerCase() === name.toLowerCase());
				if (!declared.length) return name;
				// Browser-style nearest face selection, then synthesize missing styles if needed.
				declared.sort(
					(a, b) =>
						Number(b.style === (font.style ?? 'normal')) -
							Number(a.style === (font.style ?? 'normal')) ||
						Math.abs(a.weight - (font.weight ?? 400)) - Math.abs(b.weight - (font.weight ?? 400))
				);
				return this.load(declared[0]);
			})
		);
		return { ...font, family: [...family.filter((f): f is string => !!f), 'sans-serif'] };
	}
	dispose() {
		this.disposed = true;
		for (const controller of this.controllers) controller.abort();
		for (const face of this.registered) document.fonts.delete(face);
		this.registered.clear();
		this.loads.clear();
	}
}

export function textStyle(font: Font): string {
	return [
		font.family && `font-family:${font.family.map(cssFamily).join(',')}`,
		font.size !== undefined && `font-size:${font.size}px`,
		font.style && `font-style:${font.style}`,
		font.weight !== undefined && `font-weight:${font.weight}`,
		font.lineHeight !== undefined && `line-height:${font.lineHeight}`,
		font.letterSpacing !== undefined && `letter-spacing:${font.letterSpacing}px`
	]
		.filter(Boolean)
		.join(';');
}
