import { archiveLimits as limits, entryPath } from './ArchiveReader';

/** RAR5 redirections are not always exposed as symlinks by the in-memory decoder's metadata API.
 * Inspect flags and extra records before invoking the decoder, never link targets.
 * Layout: https://www.rarlab.com/technote.htm (all offsets checked against the header).
 */
export function rar5Links(bytes: Uint8Array): Set<string> {
	const links = new Set<string>();
	if (bytes[6] !== 1) return links;
	let offset = 8,
		blocks = 0;
	while (offset < bytes.length) {
		if (++blocks > limits.entries + 100) throw new Error('Archive entry count limit exceeded');
		let cursor = offset + 4,
			end = bytes.length;
		const vint = () => {
			let result = 0;
			for (let shift = 0; shift < 56; shift += 7) {
				if (cursor >= end) throw new Error('Malformed RAR5 header');
				const b = bytes[cursor++];
				result += (b & 127) * 2 ** shift;
				if (!Number.isSafeInteger(result)) throw new Error('RAR5 integer exceeds supported limits');
				if (!(b & 128)) return result;
			}
			throw new Error('Malformed RAR5 integer');
		};
		const length = vint();
		end = cursor + length;
		if (end > bytes.length || end <= offset + 4) throw new Error('Truncated RAR5 header');
		const type = vint(),
			flags = vint();
		const extra = flags & 1 ? vint() : 0;
		const packed = flags & 2 ? vint() : 0;
		if (flags & 0x18) throw new Error('Multipart archives are unsupported');
		if (type === 4) throw new Error('Encrypted archives are unsupported');
		if (type === 1 && vint() & 1) throw new Error('Multipart archives are unsupported');
		if (type === 2 || type === 3) {
			const fileFlags = vint();
			if (fileFlags & 8) throw new Error('RAR entries with unknown output size are unsupported');
			vint();
			vint();
			if (fileFlags & 2) cursor += 4;
			if (fileFlags & 4) cursor += 4;
			const compression = vint();
			if (compression & 63) throw new Error('Unsupported RAR compression version');
			if (128 * 1024 * 2 ** ((compression >>> 10) & 31) > limits.rarDictionary)
				throw new Error('RAR dictionary size limit exceeded');
			vint();
			const nameLength = vint();
			if (cursor + nameLength > end - extra) throw new Error('Malformed RAR5 filename');
			const name = entryPath(
				new TextDecoder('utf-8', { fatal: true }).decode(
					bytes.subarray(cursor, cursor + nameLength)
				)
			);
			cursor = end - extra;
			if (cursor < offset || extra < 0) throw new Error('Malformed RAR5 extra area');
			while (cursor < end) {
				const size = vint(),
					recordEnd = cursor + size;
				if (!size || recordEnd > end) throw new Error('Malformed RAR5 extra record');
				const recordType = vint();
				if (recordType === 1) throw new Error('Encrypted archives are unsupported');
				if (recordType === 5) links.add(name);
				cursor = recordEnd;
			}
		}
		if (end + packed > bytes.length) throw new Error('Truncated RAR5 data');
		offset = end + packed;
		if (type === 5) break;
	}
	return links;
}
/** RAR4 does not expose Unix symlink attributes through node-unrar-js's headers. */
export function rar4LinkIndexes(bytes: Uint8Array): Set<number> {
	const links = new Set<number>();
	if (bytes[6] !== 0) return links;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 7,
		index = 0,
		blocks = 0;
	while (offset + 7 <= bytes.length) {
		if (++blocks > limits.entries + 100) throw new Error('Archive entry count limit exceeded');
		const type = bytes[offset + 2],
			flags = view.getUint16(offset + 3, true),
			length = view.getUint16(offset + 5, true);
		if (length < 7 || offset + length > bytes.length) throw new Error('Truncated RAR4 header');
		let packed = flags & 0x8000 ? view.getUint32(offset + 7, true) : 0;
		if (type === 0x74) {
			if (length < 32) throw new Error('Malformed RAR4 file header');
			if (flags & 3) throw new Error('Multipart archives are unsupported');
			if (flags & 4) throw new Error('Encrypted archives are unsupported');
			if (flags & 0x100) {
				if (length < 40) throw new Error('Malformed large RAR4 header');
				packed += view.getUint32(offset + 32, true) * 2 ** 32;
			}
			const mode = view.getUint32(offset + 28, true) & 0xf000;
			if (bytes[offset + 15] === 3 && mode !== 0x8000 && mode !== 0x4000) links.add(index);
			index++;
		}
		if (!Number.isSafeInteger(packed) || offset + length + packed > bytes.length)
			throw new Error('Truncated RAR4 data');
		offset += length + packed;
		if (type === 0x7b) break;
	}
	return links;
}
