import { copyFile, mkdir, readdir } from 'node:fs/promises';
await mkdir('static/codecs', { recursive: true });
for (const [source, target] of [
	['node_modules/libarchive.js/src/webworker/wasm-gen/libarchive.js', 'libarchive.js'],
	['node_modules/libarchive.js/dist/libarchive.wasm', 'libarchive.wasm'],
	['node_modules/libarchive.js/LICENSE', 'LICENSE.libarchive-js'],

	['node_modules/@zip.js/zip.js/LICENSE', 'LICENSE.zip-js']
])
	await copyFile(source, 'static/codecs/' + target);

for (const name of await readdir('third-party/archive-codecs'))
	await copyFile('third-party/archive-codecs/' + name, 'static/codecs/' + name);
