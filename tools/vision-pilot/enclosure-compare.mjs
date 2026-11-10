/** Replay the Merge dialog options with frozen OCR words and original RGBA pixels. */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mergeOcrBubbles } from '../../src/lib/ocr.ts';

const { values } = parseArgs({
	options: { inputs: { type: 'string', multiple: true }, output: { type: 'string' } }
});
if (!values.inputs?.length || !values.output)
	throw new Error('Supply --inputs manifest.json [--inputs another.json] --output review.json');

const variants = [
	{ name: 'geometry', boundaries: false, inclination: false },
	{ name: 'boundaries', boundaries: true, inclination: false },
	{ name: 'inclination', boundaries: false, inclination: true },
	{ name: 'combined', boundaries: true, inclination: true }
];
const pages = [];
for (const manifest of values.inputs) {
	const dir = dirname(resolve(manifest));
	for (const { id, width, height, rgba, ocr } of JSON.parse(readFileSync(manifest, 'utf8'))) {
		const words = JSON.parse(readFileSync(resolve(dir, ocr), 'utf8')).pages[0].bubbles;
		const pixels = { width, height, data: readFileSync(resolve(dir, rgba)) };
		if (pixels.data.length !== width * height * 4)
			throw new Error(`Invalid RGBA dimensions for page ${id}`);
		const groups = Object.fromEntries(
			variants.map(({ name, boundaries, inclination }) => [
				name,
				mergeOcrBubbles(words, boundaries ? pixels : undefined, inclination)
			])
		);
		pages.push({ id, groups });
	}
}
writeFileSync(values.output, JSON.stringify({ variants, pages }, null, 2));
