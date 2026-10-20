import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';
import { crc32 } from 'node:zlib';
export const png = new Uint8Array(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ioAAAAASUVORK5CYII=',
		'base64'
	)
);
export const overlay = new TextEncoder().encode(
	JSON.stringify({
		pages: [
			{
				bubbles: [
					{
						text: 'Archive hello',
						shape: {
							type: 'box',
							vs: [
								{ x: 0, y: 0 },
								{ x: 1, y: 1 }
							]
						}
					}
				]
			}
		]
	})
);
export const comicEntries: Record<string, Uint8Array> = {
	'nested/10.png': png,
	'nested/2.png': png,
	'z/1.png': png,
	'nested/2.en.bbl': overlay,
	'__MACOSX/ghost.png': png,
	'.DS_Store': png,
	'nested/inner.cbz': png
};
export async function zipBytes(
	entries = comicEntries,
	options: { level?: number; password?: string } = {}
) {
	const zip = new ZipWriter(new Uint8ArrayWriter());
	for (const [name, bytes] of Object.entries(entries))
		await zip.add(name, new Uint8ArrayReader(bytes), options);
	return await zip.close();
}
/** Minimal RAR4 stored fixture encoder, used only by tests. No external archiver. */
export function rarBytes(entries = comicEntries) {
	const blocks: Buffer[] = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 7, 0])];
	function header(type: number, flags: number, body: Buffer) {
		const h = Buffer.alloc(7 + body.length);
		h[2] = type;
		h.writeUInt16LE(flags, 3);
		h.writeUInt16LE(h.length, 5);
		body.copy(h, 7);
		h.writeUInt16LE(crc32(h.subarray(2)) & 0xffff, 0);
		return h;
	}
	blocks.push(header(0x73, 0, Buffer.alloc(6)));
	for (const [name, bytes] of Object.entries(entries)) {
		const n = Buffer.from(name);
		const body = Buffer.alloc(25 + n.length);
		body.writeUInt32LE(bytes.length, 0);
		body.writeUInt32LE(bytes.length, 4);
		body[8] = 3;
		body.writeUInt32LE(crc32(bytes), 9);
		body[17] = 20;
		body[18] = 0x30;
		body.writeUInt16LE(n.length, 19);
		body.writeUInt32LE(0x81a4, 21);
		n.copy(body, 25);
		blocks.push(header(0x74, 0x8000, body), Buffer.from(bytes));
	}
	blocks.push(header(0x7b, 0, Buffer.alloc(0)));
	return new Uint8Array(Buffer.concat(blocks));
}
