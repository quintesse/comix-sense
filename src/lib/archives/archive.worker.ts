import { rar5Links, rar4LinkIndexes } from './RarHeaders';
import {
	archiveLimits as limits,
	entryPath,
	ignoredPath,
	type ArchiveEntry
} from './ArchiveReader';

const metrics = { heapBytes: 0, skippedDeclaredBytes: 0, version: '' };
// Worker is terminated after every operation, including errors and timeouts. In particular
// the decoder's internal allocations and compressed input never survive an extraction.
self.onmessage = async ({
	data: { file, path, codecBase }
}: MessageEvent<{ file: File; path?: string; codecBase: string }>) => {
	try {
		const start = performance.now();
		const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
		const zip =
			signature[0] === 0x50 &&
			signature[1] === 0x4b &&
			((signature[2] === 3 && signature[3] === 4) || (signature[2] === 5 && signature[3] === 6));
		const rar =
			[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07].every((v, i) => signature[i] === v) &&
			(signature[6] === 0 || (signature[6] === 1 && signature[7] === 0));
		if (!zip && !rar)
			throw new Error('Malformed or unsupported archive signature (expected ZIP or RAR)');
		if (file.size > (zip ? limits.zipInput : limits.rarInput))
			throw new Error('Archive input size limit exceeded');
		const result = zip ? await readZip(file, path) : await readRar(file, path, codecBase);
		self.postMessage({ result, metrics: { ...metrics, ms: performance.now() - start } });
	} catch (error) {
		self.postMessage({ error: String(error) });
	}
};
function collector() {
	const seen = new Set<string>();
	const entries: ArchiveEntry[] = [];
	let count = 0;
	return {
		entries,
		add(raw: string, size: number, regular: boolean) {
			if (++count > limits.entries) throw new Error('Archive entry count limit exceeded');
			const name = entryPath(raw);
			if (seen.has(name.replace(/\/$/, '')))
				throw new Error('Ambiguous duplicate archive path: ' + name);
			seen.add(name.replace(/\/$/, ''));
			if (!Number.isSafeInteger(size) || size < 0 || size > limits.entryOutput)
				throw new Error('Archive entry output size limit exceeded: ' + name);
			if (regular && !ignoredPath(name)) entries.push({ path: name, size });
			return name;
		}
	};
}
async function readZip(file: File, path?: string) {
	const { ZipReader, BlobReader, configure } = await import('@zip.js/zip.js/index-native.js');
	configure({ useWebWorkers: false });
	const reader = new ZipReader(new BlobReader(file));
	const index = collector();
	try {
		let target;
		for await (const entry of reader.getEntriesGenerator()) {
			if (entry.encrypted) throw new Error('Encrypted archives are unsupported');
			if (entry.diskNumberStart !== 0) throw new Error('Multipart archives are unsupported');
			const name = index.add(
				entry.filename,
				entry.uncompressedSize,
				!entry.directory && !entry.symlink
			);
			if (name === path && !entry.directory && !entry.symlink) target = entry;
		}
		if (path === undefined) return index.entries;
		if (!target) throw new Error('Archive entry not found: ' + path);
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		let bytes = 0;
		await target.getData(
			new WritableStream<Uint8Array<ArrayBuffer>>({
				write(chunk) {
					bytes += chunk.byteLength;
					if (bytes > limits.entryOutput)
						throw new Error('Actual archive output size limit exceeded');
					chunks.push(chunk);
				}
			}),
			{ checkSignature: true }
		);
		return new Blob(chunks);
	} finally {
		await reader.close();
	}
}
function rarMainHeader(bytes: Uint8Array) {
	if (bytes[6] === 0) {
		const flags = bytes[10] | (bytes[11] << 8);
		if (flags & 1) throw new Error('Multipart archives are unsupported');
		if (flags & 0x80) throw new Error('Encrypted archives are unsupported');
	} else {
		let offset = 12;
		const vint = () => {
			let value = 0,
				shift = 0;
			for (let n = 0; n < 8; n++) {
				if (offset >= bytes.length) throw new Error('Malformed RAR header');
				const b = bytes[offset++];
				value += (b & 127) * 2 ** shift;
				if (!(b & 128)) return value;
				shift += 7;
			}
			throw new Error('Malformed RAR integer');
		};
		vint();
		const type = vint();
		const flags = vint();
		if (type === 4) throw new Error('Encrypted archives are unsupported');
		if (type !== 1) throw new Error('Malformed RAR main header');
		if (flags & 1) vint();
		if (flags & 2) vint();
		if (vint() & 1) throw new Error('Multipart archives are unsupported');
	}
}
async function readRar(file: File, path: string | undefined, codecBase: string) {
	rarMainHeader(new Uint8Array(await file.slice(0, 256).arrayBuffer()));
	const input = new Uint8Array(await file.arrayBuffer());
	const links = rar5Links(input);
	rar4LinkIndexes(input);
	const url = new URL(codecBase + 'libarchive.js', self.location.origin).href;
	const { default: factory } = await import(/* @vite-ignore */ url);
	const wasm = await factory({
		locateFile: (name: string) => new URL(codecBase + name, self.location.origin).href
	});
	const fn = (name: string, result: string | null, args: string[]) =>
		wasm.cwrap(name, result, args);
	metrics.version = fn('get_version', 'string', [])();
	const malloc = fn('malloc', 'number', ['number']),
		free = fn('free', null, ['number']);
	const ptr = malloc(input.length);
	wasm.HEAPU8.set(input, ptr);
	const archive = fn('archive_open', 'number', ['number', 'number', 'string', 'string'])(
		ptr,
		input.length,
		null,
		'en_US.UTF-8'
	);
	const next = fn('get_next_entry', 'number', ['number']);
	const name = fn('archive_entry_pathname', 'string', ['number']);
	const size = fn('archive_entry_size', 'number', ['number']);
	const type = fn('archive_entry_filetype', 'number', ['number']);
	const encrypted = fn('archive_entry_is_encrypted', 'number', ['number']);
	const skip = fn('archive_read_data_skip', 'number', ['number']);
	const error = fn('archive_error_string', 'string', ['number']);
	const get = fn('get_filedata', 'number', ['number', 'number']);
	const index = collector();
	let total = 0;
	let output: Blob | undefined;
	try {
		for (let entry; (entry = next(archive)) !== 0;) {
			if (encrypted(entry)) throw new Error('Encrypted archives are unsupported');
			const length = size(entry);
			total += length;
			if (total > limits.rarDeclaredOutput)
				throw new Error('RAR total declared output limit exceeded');
			const rawName = name(entry),
				regular = type(entry) === 32768 && !links.has(entryPath(rawName));
			const normalized = index.add(rawName, length, regular);
			if (path === normalized && regular) {
				const data = get(archive, length);
				if (data < 0) throw new Error(error(archive) || 'RAR extraction failed');
				// Known libarchive.js gap: this helper does not expose actual read length and
				// can miss a stored-entry CRC mismatch. Regression test records the deferred issue.
				output = new Blob([wasm.HEAPU8.slice(data, data + length)]);
				free(data);
			} else {
				metrics.skippedDeclaredBytes += length;
				if (skip(archive) < 0) throw new Error(error(archive) || 'RAR skip failed');
			}
		}
		const failure = error(archive);
		if (failure) throw new Error(failure);
		if (path !== undefined && !output) throw new Error('Archive entry not found: ' + path);
		metrics.heapBytes = wasm.HEAPU8.byteLength;
		return path === undefined ? index.entries : output;
	} finally {
		fn('archive_close', null, ['number'])(archive);
		free(ptr);
	}
}
