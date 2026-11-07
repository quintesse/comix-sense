import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validate, identities, evaluate, compare, hash } from './core.mjs';
import * as production from './current.mjs';
import { html } from './report.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const inside = (parent, child) => {
	const relative = path.relative(parent, child);
	return (
		relative === '' ||
		(!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
	);
};
async function resolvedDestination(file) {
	try {
		return await realpath(file);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		return path.join(await resolvedDestination(path.dirname(file)), path.basename(file));
	}
}
// Enriched inputs can repeat large provider records. Stream the report rather
// than constructing a single string that exceeds the runtime's string limit.
function* jsonChunks(value, depth = 0) {
	if (depth >= 5 || value === null || typeof value !== 'object') {
		yield JSON.stringify(value);
	} else if (Array.isArray(value)) {
		yield '[';
		for (let i = 0; i < value.length; i++) {
			if (i) yield ',';
			yield* jsonChunks(value[i], depth + 1);
		}
		yield ']';
	} else {
		yield '{';
		let separator = '';
		for (const [key, entry] of Object.entries(value)) {
			if (entry === undefined) continue;
			yield separator + JSON.stringify(key) + ':';
			yield* jsonChunks(entry, depth + 1);
			separator = ',';
		}
		yield '}';
	}
}
try {
	const args = process.argv.slice(2),
		options = {};
	for (let i = 0; i < args.length; i += 2) {
		if (
			!['--dataset', '--output', '--baseline'].includes(args[i]) ||
			!args[i + 1] ||
			args[i + 1].startsWith('--') ||
			options[args[i]]
		)
			throw new Error(
				'Usage: --dataset CASES.json --output NEW_DIRECTORY [--baseline report.json]'
			);
		options[args[i]] = args[i + 1];
	}
	if (!options['--dataset'] || !options['--output'])
		throw new Error('Explicit --dataset and --output required');
	const dataset = await realpath(path.resolve(options['--dataset']));
	const output = await resolvedDestination(path.resolve(options['--output']));
	// Reports may contain private text and images. Never place them in tracked source paths.
	if (inside(root, output) && !inside(path.join(root, 'comics'), output))
		throw new Error('Output must be outside the checkout or beneath ignored comics/');
	if (inside(output, dataset)) throw new Error('Output cannot contain the dataset');
	const data = validate(JSON.parse(await readFile(dataset, 'utf8')));
	const implementationFiles = [
		'src/lib/mergeBubbles.ts',
		'src/lib/types/Comic.ts',
		'src/lib/types/funcs.ts',
		'src/lib/ocr.ts',
		'src/lib/bbl/metadata.ts',
		'src/lib/maskAppearance.ts',
		'tools/merge-eval/current.mjs',
		'tools/merge-eval/core.mjs',
		'tools/merge-eval/loader.mjs',
		'tools/merge-eval/register.mjs',
		'tools/merge-eval/cli.mjs',
		'tools/merge-eval/report.mjs',
		'package-lock.json'
	];
	const sources = await Promise.all(
		implementationFiles.map(async (file) => [file, await readFile(path.join(root, file), 'utf8')])
	);
	const started = performance.now();
	const pages = data.pages.map((input) => {
		const start = performance.now(),
			groups = production.predict(input),
			runtimeMs = performance.now() - start;
		const errors = [],
			unscored = [];
		const metrics = evaluate(input, groups, errors, unscored);
		return {
			id: input.id,
			...identities(input),
			input,
			groups,
			metrics,
			errors: errors.map((value) => JSON.parse(value)),
			unscored: unscored.map((value) => JSON.parse(value)),
			runtimeMs,
			appFiltering: {
				kept: groups.filter((g) => /\p{L}/u.test(g.bubble.text)).length,
				removed: groups.filter((g) => !/\p{L}/u.test(g.bubble.text)).length
			}
		};
	});
	const aggregate = {};
	for (const page of pages)
		for (const [key, value] of Object.entries(page.metrics))
			aggregate[key] = (aggregate[key] ?? 0) + value;
	const report = {
		schemaVersion: 1,
		metricVersion: 1,
		algorithm: production.algorithm,
		provenance: {
			createdAt: new Date().toISOString(),
			revision: git('rev-parse', 'HEAD'),
			dirty: git('status', '--porcelain', '--untracked-files=all') !== '',
			implementationHash: hash(sources),
			configuration: { policy: 'current production constants; no overrides' },
			node: process.version
		},
		pages,
		aggregate,
		runtimeMs: performance.now() - started
	};
	let comparisonFailed = false;
	if (options['--baseline']) {
		try {
			report.comparison = compare(
				report,
				JSON.parse(await readFile(options['--baseline'], 'utf8'))
			);
		} catch (error) {
			report.comparisonError = error.message;
			comparisonFailed = true;
		}
	}
	const visual = await html(report, path.dirname(dataset));
	// New directory only: never overwrite datasets, baseline reports or prior review artifacts.
	await mkdir(output, { recursive: false });
	await pipeline(
		Readable.from(jsonChunks(report)),
		createWriteStream(path.join(output, 'report.json'), { flags: 'wx' })
	);
	await writeFile(path.join(output, 'index.html'), visual);
	const regression = report.comparison?.some((p) => p.regressions.length > 0);
	console.log(
		JSON.stringify(
			{
				output,
				aggregate,
				runtimeMs: report.runtimeMs,
				comparison: report.comparison?.map(({ previous, ...rest }) => rest),
				comparisonError: report.comparisonError
			},
			null,
			2
		)
	);
	process.exitCode = comparisonFailed ? 3 : regression ? 4 : 0;
} catch (error) {
	console.error(`Merge evaluation: ${error.message}`);
	process.exitCode = 2;
}
