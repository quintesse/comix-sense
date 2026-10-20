export type StrStrMap = { [key: string]: string };

/** Map pointer coordinates into the page's coordinate system, including CSS zoom. */
export function svgPoint(svg: SVGSVGElement, event: MouseEvent) {
	const matrix = svg.getScreenCTM();
	if (!matrix) return { x: 0, y: 0 };
	const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
	return { x: point.x, y: point.y };
}

export const supportedImageTypes = ['bmp', 'gif', 'jpg', 'jpeg', 'png', 'webp'];

/** Hide a redundant parent name and separators, retaining a nonempty label. */
export function withoutParentPrefix(name: string, parent: string): string {
	if (!name.toLowerCase().startsWith(parent.toLowerCase())) return name;
	return name.slice(parent.length).replace(/^[^\p{L}\p{N}]+/u, '') || name;
}

/** Strip a known collection + album heading while retaining the original suffix. */
export function withoutAlbumPrefix(name: string, collection: string, album: string): string {
	const letters = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
	const collectionName = letters(collection),
		albumName = letters(album);
	if (!collectionName || !albumName) return name;
	const prefixes = [collectionName + albumName];
	// Album folders/archives may already include their collection name.
	if (albumName.startsWith(collectionName)) prefixes.push(albumName);
	for (const prefix of prefixes) {
		let matched = 0,
			offset = 0;
		for (const character of name) {
			offset += character.length;
			const part = letters(character);
			if (!prefix.startsWith(part, matched)) break;
			matched += part.length;
			if (matched === prefix.length) {
				const suffix = name.slice(offset).replace(/^[^\p{L}\p{N}]+/u, '');
				if (suffix) return suffix;
				break;
			}
		}
	}
	return name;
}

/** Find a shared label prefix in linear time. */
export function sharedFilenamePrefix(names: string[]): string {
	if (names.length < 2) return '';
	const first = names[0];
	let length = first.length;
	for (let i = 1; i < names.length && length > 0; i++) {
		let match = 0;
		while (match < length && first[match] === names[i][match]) match++;
		length = match;
	}
	const prefix = first.slice(0, length);
	// A single page or a name equal to the prefix must keep its readable label.
	return prefix && names.every((name) => name.slice(prefix.length).trim().length > 0) ? prefix : '';
}

/**
 * Given a file name it returns a tuple of the base file name
 * without the extension and the extension. In case no extension
 * exists it will return a tuple of the original file name and
 * an emnpty string.
 */
export function baseNameExt(name: string): [string, string] {
	const p = name.lastIndexOf('.');
	if (p > 0) {
		return [name.substring(0, p), name.substring(p + 1)];
	} else {
		return [name, ''];
	}
}

export function dirFileName(name: string) {
	const p = name.lastIndexOf('/');
	if (p > 0) {
		return [name.substring(0, p), name.substring(p + 1)];
	} else {
		return ['', name];
	}
}

/**
 * Takes a base directory handle and a path to a file and returns
 * a handle to the file.
 */
export async function resolveFile(
	dir: FileSystemDirectoryHandle,
	path: string
): Promise<FileSystemFileHandle> {
	const parts = path.split('/');
	for (let i = 0; i < parts.length - 1; i++) {
		dir = await dir.getDirectoryHandle(parts[i]);
	}
	return dir.getFileHandle(parts[parts.length - 1]);
}

export function dedup(arr: any[]) {
	return [...new Set(arr)];
}
