import fs from 'node:fs/promises';
const root =
	'https://raw.githubusercontent.com/libarchive/libarchive/03b426003adf12c1eb4c34e72bedb4c2bf1ba8d3/';
for (const name of [
	'test_read_format_rar.rar',
	'test_read_format_rar5_compressed.rar',
	'test_read_format_rar5_solid.rar',
	'test_read_format_rar4_encrypted.rar',
	'test_read_format_rar5_hardlink.rar',
	'test_read_format_rar5_symlink.rar',
	'test_read_format_rar5_encrypted.rar'
]) {
	const text = await (await fetch(root + 'libarchive/test/' + name + '.uu')).text();
	const lines = text.split('\n');
	let output = [];
	let active = false;
	for (const line of lines) {
		if (line.startsWith('begin ')) {
			active = true;
			continue;
		}
		if (!active || line === 'end') continue;
		const count = (line.charCodeAt(0) - 32) & 63;
		let bytes = [];
		for (let i = 1; i < line.length; i += 4) {
			const v = [0, 1, 2, 3].map((n) => (line.charCodeAt(i + n) - 32) & 63);
			bytes.push(
				(v[0] << 2) | (v[1] >> 4),
				((v[1] & 15) << 4) | (v[2] >> 2),
				((v[2] & 3) << 6) | v[3]
			);
		}
		output.push(...bytes.slice(0, count));
	}
	await fs.writeFile('tests/fixtures/archives/' + name, new Uint8Array(output));
}
await fs.writeFile(
	'tests/fixtures/archives/LICENSE.libarchive',
	await (await fetch(root + 'COPYING')).text()
);
