import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	copyFileSync
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import {
	albumTypography,
	typographyAssets,
	writeAlbumTypography,
	defaultFont,
	fontCachePath
} from './typography.mjs';
import { renderer } from './render.mjs';
import { save, hash } from './core.mjs';

const box = (width, height) => ({
	type: 'box',
	vs: [
		{ x: 0, y: 0 },
		{ x: width, y: height }
	]
});

test('album settings use verified local font assets and exported albums have portable font declarations', async () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'pilot-typography-'));
	const require = createRequire(import.meta.url);
	const bundled = resolve(
		dirname(require.resolve('playwright-core/package.json')),
		'lib/vite/traceViewer'
	);
	const fixtureFont = readdirSync(bundled).find((p) => /^codicon.*\.ttf$/.test(p));
	assert.ok(fixtureFont, 'Playwright supplies a valid test font without private artwork/assets');
	copyFileSync(resolve(bundled, fixtureFont), resolve(dir, 'synthetic.ttf'));
	const settings = resolve(dir, 'album.bbl');
	const family = 'Synthetic Font </style><script>throw 1</script>';
	save(settings, {
		font: {
			family: [family.toLowerCase(), 'sans-serif'],
			size: 35,
			style: 'normal',
			weight: 400,
			lineHeight: 1
		},
		fontFaces: [{ family, src: 'synthetic.ttf', style: 'normal', weight: 400 }]
	});
	const config = albumTypography(settings);
	assert.equal(config.font.size, 35);
	assert.equal(config.faces[0].sha256, hash(resolve(dir, 'synthetic.ttf')));
	const assets = typographyAssets(config);
	assert.match(assets[0].data, /^data:font\/ttf;base64,/);
	const output = resolve(dir, 'export');
	mkdirSync(output);
	writeAlbumTypography(output, config);
	const exported = JSON.parse(readFileSync(resolve(output, 'album.bbl')));
	assert.equal(exported.fontFaces[0].src, 'fonts/face-1.ttf');
	assert.equal(hash(resolve(output, exported.fontFaces[0].src)), config.faces[0].sha256);
	const render = await renderer(dir, assets);
	try {
		const fitted = await render.fit(
			[{ text: 'Synthetic test', shape: box(400, 100) }],
			config.font
		);
		assert.equal(fitted[0].font.size, 35);
		save(resolve(dir, 'page.bbl'), { font: config.font, pages: [{ bubbles: fitted }] });
		const result = await render.render(
			'test',
			resolve(dir, 'page.bbl'),
			'data:image/svg+xml;base64,' +
				Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"/>').toString(
					'base64'
				),
			{ width: 400, height: 100 },
			{ file: 'compare.html', source: 'nl', target: 'nl' }
		);
		assert.equal(result.loadedFontFaces[0].family, family);
		assert.equal(result.renderedFonts[0].size, 35);
		assert.match(result.renderedFonts[0].family, /synthetic font/);
		assert.deepEqual(result.overflow, []);
		assert.match(readFileSync(resolve(dir, 'test.html'), 'utf8'), /font-src data:/);
		assert.ok(!readFileSync(resolve(dir, 'test.html'), 'utf8').includes(family));
	} finally {
		await render.close();
	}
	writeFileSync(resolve(dir, 'synthetic.ttf'), 'changed');
	assert.throws(() => typographyAssets(config), /font asset changed/);
});

test('missing metadata retains default; configured remote faces require an offline cache', () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'pilot-font-missing-'));
	assert.equal(albumTypography(resolve(dir, 'missing.bbl')), null);
	assert.equal(defaultFont.size, 35);
	const source = 'https://example.invalid/synthetic.woff';
	assert.match(fontCachePath(source), /\.woff$/);
	save(resolve(dir, 'album.bbl'), {
		font: { family: ['Missing Font'] },
		fontFaces: [{ family: 'Missing Font', src: source, style: 'italic', weight: 400 }]
	});
	assert.throws(() => albumTypography(resolve(dir, 'album.bbl')), /Offline font asset missing/);
});

test('spacing is tightened before shrinking and roomy passages retain configured size', async () => {
	const dir = mkdtempSync(resolve(tmpdir(), 'pilot-spacing-'));
	const render = await renderer(dir);
	try {
		const font = {
			family: ['monospace'],
			size: 35,
			style: 'normal',
			lineHeight: 1,
			letterSpacing: 0
		};
		const bubbles = [
			...Array.from({ length: 81 }, (_, i) => ({ text: 'WWWWWWWWWW', shape: box(150 + i, 44) })),
			...Array.from({ length: 5 }, () => ({
				text: 'Some much longer text to fit in a small rectangle.',
				shape: box(95, 41)
			})),
			{ text: 'Roomy', shape: box(500, 150) }
		];
		const fitted = await render.fit(bubbles, font);
		const tightened = fitted
			.slice(0, 81)
			.filter((b) => b.font.size === 35 && b.font.letterSpacing < 0);
		assert.ok(tightened.length, 'A near-fit width must retain 35px by tightening');
		assert.ok(tightened.every((b) => b.font.letterSpacing >= -0.6));
		assert.ok(fitted[81].font.size < 35);
		assert.equal(
			fitted.at(-1).font.size,
			35,
			'Other tight balloons must not lower a roomy balloon font'
		);
		assert.equal(fitted.at(-1).font.letterSpacing, 0);
		const unneeded = await render.fit([{ text: 'WWWWWWWWWW', shape: box(230, 44) }], font);
		assert.equal(unneeded[0].font.letterSpacing, 0);
	} finally {
		await render.close();
	}
});
