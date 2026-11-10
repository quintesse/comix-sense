import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocument, Diagnostics } from '../../src/lib/bbl/metadata.ts';

import { textStyle, cssFamily } from '../../src/lib/bbl/FontResources.ts';
import { fittingCandidates, fittingSpace } from './lettering.mjs';
import { comparisonHtml } from './comparison.mjs';

export async function renderer(output, fontFaces = []) {
	let lastFitSpaces = [];
	const fontCss = fontFaces
		.map(
			(face) =>
				`@font-face{font-family:${cssFamily(face.family)};font-style:${face.style};font-weight:${face.weight};src:url("${face.data}")}`
		)
		.join('\n')
		.replaceAll('<', '\\3c ');
	const loadFonts = async (page) => {
		await page.evaluate(
			async (faces) => {
				for (const face of faces) {
					const loaded = await document.fonts.load(
						`${face.style} ${face.weight} 35px ${JSON.stringify(face.family)}`
					);
					if (!loaded.length || loaded.some((f) => f.status !== 'loaded'))
						throw Error(`Offline font did not load: ${face.family}`);
				}
				await document.fonts.ready;
			},
			fontFaces.map(({ family, style, weight }) => ({ family, style, weight }))
		);
	};
	const component = resolve(dirname(fileURLToPath(import.meta.url)), 'Viewer.svelte').replaceAll(
		'\\',
		'/'
	);
	const bundle = await build({
		configFile: false,
		logLevel: 'error',
		plugins: [
			svelte(),
			{
				name: 'pilot-entry',
				resolveId: (id) => (id === 'pilot-entry' ? '\0pilot-entry' : null),
				load: (id) =>
					id === '\0pilot-entry'
						? `import {mount} from 'svelte'; import Viewer from ${JSON.stringify(component)}; mount(Viewer,{target:document.body,props:window.pilot}); window.ready=true;`
						: null
			}
		],
		build: {
			write: false,
			minify: false,
			rollupOptions: {
				input: 'pilot-entry',
				output: { format: 'iife' }
			}
		}
	});
	const artifacts = bundle.output;
	const js = artifacts.find((a) => a.type === 'chunk').code;
	const css = artifacts
		.filter((a) => a.fileName.endsWith('.css'))
		.map((a) => a.source)
		.join('\n');
	const browser = await chromium.launch({
		channel: process.platform === 'win32' ? 'msedge' : undefined,
		headless: true
	});
	// Decode required local font assets before replay begins.
	if (fontFaces.length) {
		const page = await browser.newPage();
		try {
			await page.addStyleTag({ content: fontCss });
			await loadFonts(page);
		} catch (error) {
			await browser.close();
			throw error;
		} finally {
			if (!page.isClosed()) await page.close();
		}
	}
	return {
		close: () => browser.close(),
		get fittingSpaces() {
			return lastFitSpaces;
		},
		async fit(bubbles, font, interiorBoxes = null) {
			const page = await browser.newPage();
			try {
				if (fontCss) await page.addStyleTag({ content: fontCss });
				await loadFonts(page);
				const inputs = bubbles.map((b, i) => ({
					boxes: fittingCandidates(b, interiorBoxes?.[i]),
					text: b.text,
					style: textStyle({ ...font, ...b.font, whiteSpace: 'normal' })
				}));
				const fittings = await page.evaluate((inputs) => {
					const probe = document.createElement('div');
					document.body.append(probe);
					const fitBox = (box, text, style, cap) => {
						const pad = box.inset
							? 0
							: Math.min(2, (box.right - box.left) / 12, (box.bottom - box.top) / 12);
						const clearance = box.inset ? 0 : 2;
						const x = box.left + pad,
							width = box.right - box.left - 2 * pad;
						const height = box.bottom - box.top - 2 * pad;
						probe.style.cssText =
							'font: 18pt/1 sans-serif; overflow-wrap:break-word; word-break:break-word;' + style;
						probe.style.width = width + 'px';
						probe.textContent = text;
						const max = Math.floor(parseFloat(getComputedStyle(probe).fontSize));
						const baseSpacing = parseFloat(getComputedStyle(probe).letterSpacing) || 0;
						const fits = (size, letterSpacing) => {
							probe.style.fontSize = size + 'px';
							probe.style.letterSpacing = letterSpacing + 'px';
							return (
								Math.max(probe.scrollHeight, probe.getBoundingClientRect().height) + clearance <=
									height && probe.scrollWidth <= Math.ceil(width)
							);
						};
						// Keep configured size first; tighten only modestly before reducing it.
						let size = Math.min(max, cap),
							letterSpacing = baseSpacing;
						let found = false;
						for (const tightening of [0, 0.2, 0.4, 0.6]) {
							letterSpacing = Math.round((baseSpacing - tightening) * 1000) / 1000;
							if (fits(size, letterSpacing)) {
								found = true;
								break;
							}
						}
						if (!found) {
							let low = 1,
								high = size - 1;
							size = 0;
							while (low <= high) {
								const mid = Math.floor((low + high) / 2);
								if (fits(mid, letterSpacing)) {
									size = mid;
									low = mid + 1;
								} else high = mid - 1;
							}
						}
						if (!size) return null;
						// At the selected size, retain as much of the configured spacing as fits.
						for (const tightening of [0, 0.2, 0.4, 0.6]) {
							letterSpacing = Math.round((baseSpacing - tightening) * 1000) / 1000;
							if (fits(size, letterSpacing)) break;
						}
						fits(size, letterSpacing);
						const used =
							Math.max(probe.scrollHeight, probe.getBoundingClientRect().height) + clearance;
						const y = (box.top + box.bottom - used) / 2;
						return {
							size,
							letterSpacing,
							layout: {
								type: 'box',
								vs: [
									{ x, y },
									{ x: x + width, y: y + used }
								]
							}
						};
					};
					const fit = ({ boxes, text, style }, cap) => {
						let best = null;
						for (const box of boxes) {
							const result = fitBox(box, text, style, cap);
							if (
								result &&
								(!best ||
									result.size > best.size ||
									(result.size === best.size && result.letterSpacing > best.letterSpacing))
							)
								best = result;
						}
						if (!best) throw Error('No fitting font size for translated passage');
						return best;
					};
					return inputs.map((input) => fit(input, Infinity));
				}, inputs);
				const fitted = bubbles.map((b, i) => ({
					...b,
					layout: fittings[i].layout,
					font: {
						...b.font,
						size: fittings[i].size,
						letterSpacing: fittings[i].letterSpacing,
						whiteSpace: 'normal'
					}
				}));
				lastFitSpaces = fittingSpace(
					inputs.map((i) => i.boxes),
					fitted
				);
				return fitted;
			} finally {
				await page.close();
			}
		},
		async render(name, bbl, image, imageSize, comparison) {
			const doc = parseDocument(
				JSON.parse(readFileSync(bbl, 'utf8')),
				bbl,
				false,
				new Diagnostics()
			);
			if (doc.pages.length !== 1) throw new Error('Generated BBL failed production parser');
			const bubbles = doc.pages[0].bubbles;
			const raw = JSON.parse(readFileSync(bbl, 'utf8'));
			if (bubbles.length !== raw.pages[0].bubbles.length)
				throw new Error('Production parser dropped bubbles');
			const props = { image, imageSize, bubbles, font: { ...doc.font, ...doc.pages[0].font } };
			const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>${css}\n${fontCss}</style></head><body><script>window.pilot=${JSON.stringify(props).replaceAll('<', '\\u003c')}</script><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
			const file = resolve(output, name + '.html');
			writeFileSync(file, html, { flag: 'wx' });
			const page = await browser.newPage({
				viewport: { width: Math.min(imageSize.width, 1400), height: 1000 }
			});
			const errors = [];
			page.on('pageerror', (e) => errors.push(e.message));
			await page.goto(pathToFileURL(file).href);
			await page.waitForFunction(() => window.ready);
			await loadFonts(page);
			await page.locator('svg > image').evaluate(async (el) => {
				const image = new Image();
				image.src = el.getAttribute('href');
				await image.decode();
			});
			await page.evaluate(() => document.fonts.ready);
			const actual = await page.locator('foreignObject div').allTextContents();
			if (JSON.stringify(actual) !== JSON.stringify(bubbles.map((b) => b.text)) || errors.length)
				throw new Error('Rendered text mismatch: ' + errors);
			const renderedFonts = await page.locator('foreignObject div').evaluateAll((els) =>
				els.map((e) => {
					const s = getComputedStyle(e);
					return {
						family: s.fontFamily,
						size: parseFloat(s.fontSize),
						style: s.fontStyle,
						weight: Number(s.fontWeight),
						letterSpacing: parseFloat(s.letterSpacing) || 0
					};
				})
			);
			for (const [i, actualFont] of renderedFonts.entries()) {
				const expected = { ...props.font, ...bubbles[i].font };
				if (
					(expected.size !== undefined && actualFont.size !== expected.size) ||
					(expected.letterSpacing !== undefined &&
						Math.abs(actualFont.letterSpacing - expected.letterSpacing) > 0.001)
				)
					throw new Error('Measured and rendered typography mismatch');
			}
			const overflow = await page.locator('foreignObject div').evaluateAll((els) =>
				els
					.map((e, i) => ({
						bubble: i,
						overflow: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1
					}))
					.filter((e) => e.overflow)
			);
			await page
				.locator('svg')
				.first()
				.screenshot({ path: resolve(output, name + '.review.png') });
			await page.close();
			writeFileSync(
				resolve(output, name + '.fitter-space.json'),
				JSON.stringify(comparison.spaces ?? lastFitSpaces, null, 2) + '\n',
				{ flag: 'wx' }
			);
			writeFileSync(
				resolve(output, comparison.file),
				comparisonHtml({
					image,
					renderedImage: `data:image/png;base64,${readFileSync(resolve(output, name + '.review.png')).toString('base64')}`,
					imageSize,
					source: comparison.source,
					target: comparison.target,
					spaces: comparison.spaces ?? lastFitSpaces
				}),
				{ flag: 'wx' }
			);
			return {
				comparison: comparison.file,
				parsedBubbles: bubbles.length,
				renderedTexts: actual.length,
				renderedFonts,
				loadedFontFaces: fontFaces.map(({ family, style, weight }) => ({ family, style, weight })),
				overflow
			};
		}
	};
}
