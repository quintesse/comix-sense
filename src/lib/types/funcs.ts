export type StrStrMap = { [key: string]: string };

/** Map pointer coordinates into the page's coordinate system, including CSS zoom. */
export function svgPoint(svg: SVGSVGElement, event: MouseEvent) {
	const matrix = svg.getScreenCTM();
	if (!matrix) return { x: 0, y: 0 };
	const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
	return { x: point.x, y: point.y };
}

export const supportedImageTypes = ['bmp', 'gif', 'jpg', 'jpeg', 'png', 'webp'];

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
