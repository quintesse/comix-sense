// Offline typography. Remote declarations use an explicitly populated private cache.
import {
	readFileSync,
	existsSync,
	realpathSync,
	mkdirSync,
	copyFileSync,
	constants
} from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseDocument, Diagnostics } from '../../src/lib/bbl/metadata.ts';
import { hash, json, save } from './core.mjs';

export const defaultFont = { family: ['sans-serif'], size: 35, style: 'italic', lineHeight: 1 };
export const fontCachePath = (url) =>
	join(
		homedir(),
		'.comix-sense',
		'fonts',
		createHash('sha256').update(url).digest('hex') + extname(new URL(url).pathname)
	);

export function albumTypography(settingsFile) {
	if (!existsSync(settingsFile)) return null;
	const diagnostics = new Diagnostics();
	const document = parseDocument(json(settingsFile), settingsFile, false, diagnostics);
	const font = { ...defaultFont, ...document.font };
	const faces = document.fontFaces
		.filter((face) =>
			font.family.some((family) => family.toLowerCase() === face.family.toLowerCase())
		)
		.map((face) => {
			const path = face.src.startsWith('https://')
				? fontCachePath(face.src)
				: resolve(dirname(settingsFile), face.src);
			if (!existsSync(path))
				throw new Error(
					`Offline font asset missing for ${face.family}: ${path}. Populate the private cache before running; no font is fetched during rendering.`
				);
			return { ...face, source: face.src, path: realpathSync(path), sha256: hash(path) };
		});
	const config = {
		font,
		faces,
		settings: { path: realpathSync(settingsFile), sha256: hash(settingsFile) }
	};
	typographyAssets(config);
	return config;
}

export function typographyAssets(config) {
	if (!config) return [];
	if (hash(config.settings.path) !== config.settings.sha256)
		throw new Error('Album typography settings changed');
	return config.faces.map((face) => {
		if (hash(face.path) !== face.sha256) throw new Error('Offline font asset changed');
		const bytes = readFileSync(face.path);
		const extension = extname(face.path).toLowerCase();
		const mime = {
			'.woff': 'font/woff',
			'.woff2': 'font/woff2',
			'.ttf': 'font/ttf',
			'.otf': 'font/otf'
		}[extension];
		if (!mime || bytes.length < 44) throw new Error('Invalid offline font asset');
		if (
			(extension === '.woff' && bytes.toString('ascii', 0, 4) !== 'wOFF') ||
			(extension === '.woff2' && bytes.toString('ascii', 0, 4) !== 'wOF2')
		)
			throw new Error('Invalid WOFF signature');
		return {
			family: face.family,
			style: face.style,
			weight: face.weight,
			data: `data:${mime};base64,${bytes.toString('base64')}`
		};
	});
}

export function writeAlbumTypography(album, config) {
	if (!config) return;
	typographyAssets(config);
	const fontFaces = config.faces.map((face, i) => {
		const src = `fonts/face-${i + 1}${extname(face.path).toLowerCase()}`;
		mkdirSync(resolve(album, 'fonts'), { recursive: true });
		copyFileSync(face.path, resolve(album, src), constants.COPYFILE_EXCL);
		if (hash(resolve(album, src)) !== face.sha256) throw new Error('Copied font asset mismatch');
		return { family: face.family, style: face.style, weight: face.weight, src };
	});
	save(resolve(album, 'album.bbl'), { font: config.font, fontFaces });
}
