import { mkdtempSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function privateOutput(parent) {
	const actual = realpathSync(parent),
		rel = relative(realpathSync(root), actual);
	if (
		!isAbsolute(rel) &&
		rel !== '..' &&
		!rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))
	) {
		const comics = resolve(root, 'comics');
		const allowed = relative(comics, actual);
		if (actual !== comics && (isAbsolute(allowed) || allowed.startsWith('..')))
			throw new Error('Output inside checkout must be under ignored comics/');
		execFileSync('git', ['check-ignore', '--quiet', actual], { cwd: root });
	}
	return mkdtempSync(resolve(actual, 'attempt-'));
}
