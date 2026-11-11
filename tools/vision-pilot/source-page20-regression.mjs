// Human-reviewed page 20 expectations. Offline scoring only: never import into the pipeline.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMembership } from './source-diagnostic.mjs';

const ids = (start, end) =>
	Array.from({ length: end - start + 1 }, (_, i) => `w${String(start + i).padStart(4, '0')}`);
const PAGE20_WORDS_SHA256 = '89ffd1987d32d27a78af0cb5ff60a8f1c7240cbd6878a1385cbb27b474a24800';

// IDs follow the frozen OCR, not passage numbers or the model's transcriptions.
export const PAGE20_GROUPS = Object.freeze(
	Object.fromEntries(
		Object.entries({
			grenade: [...ids(18, 25), ...ids(37, 43)],
			wiske: [...ids(26, 30), ...ids(44, 48)],
			jerom: ids(31, 36),
			soldierLeft: [...ids(81, 85), ...ids(91, 93)],
			soldierRight: [...ids(86, 90), ...ids(94, 109)],
			bottomDialogue: [...ids(110, 116), ...ids(122, 124)],
			explosion: ids(130, 130),
			bottomSoldier: ids(117, 121),
			bottomReply: ids(125, 129),
			bottomFinal: ids(142, 156)
		}).map(([name, values]) => [name, Object.freeze(values)])
	)
);

export function scorePage20(request, response) {
	const model = inspectMembership(request, response);
	const supplied = new Set(model.words.map((w) => w.id));
	const unavailable = [...new Set(Object.values(PAGE20_GROUPS).flat())].filter(
		(id) => !supplied.has(id)
	);
	if (unavailable.length)
		throw new Error(`Page 20 review IDs absent from request: ${unavailable.join(', ')}`);
	const groups = Object.fromEntries(
		Object.entries(PAGE20_GROUPS).map(([name, expected]) => {
			const related = model.passages.filter((p) => p.tokens.some((t) => expected.includes(t.id)));
			const actual = related.length === 1 ? related[0].tokens.map((t) => t.id) : [];
			return [
				name,
				{
					passed: actual.length === expected.length && actual.every((id, i) => id === expected[i]),
					passages: related.map((p) => p.number),
					expectedIds: expected,
					actualIds: related.map((p) => ({ passage: p.number, ids: p.tokens.map((t) => t.id) }))
				}
			];
		})
	);
	const separate = (a, b) =>
		groups[a].passed && groups[b].passed && groups[a].passages[0] !== groups[b].passages[0];
	const bottomSequence = [
		'bottomDialogue',
		'explosion',
		'bottomSoldier',
		'bottomReply',
		'bottomFinal'
	];
	// Score panel sequence independently of exact balloon grouping and OCR coverage.
	const positions = Object.fromEntries(
		bottomSequence.map((name) => [
			name,
			PAGE20_GROUPS[name].flatMap((id) =>
				model.words
					.find((w) => w.id === id)
					.occurrences.filter((o) => o.passage)
					.map((o) => o.passage)
			)
		])
	);
	const bottomOrder = bottomSequence.every(
		(name, i) =>
			PAGE20_GROUPS[name].every(
				(id) =>
					model.words.find((w) => w.id === id).occurrences.filter((o) => o.passage).length === 1
			) &&
			(i === 0 || Math.max(...positions[bottomSequence[i - 1]]) < Math.min(...positions[name]))
	);
	const checks = {
		grenade: groups.grenade.passed,
		wiskeAndJerom: separate('wiske', 'jerom'),
		soldiers: separate('soldierLeft', 'soldierRight'),
		bottomPanelOrder: bottomOrder
	};
	const coverage = {
		passed: model.coverage.missing.length === 0 && model.coverage.unknown.length === 0,
		supplied: model.coverage.supplied,
		accounted: model.coverage.accounted,
		missing: model.coverage.missing,
		unknown: model.coverage.unknown.map(({ id, passage, order, exclusion }) => ({
			id,
			passage,
			order,
			exclusion
		}))
	};
	const uniqueness = {
		passed: model.coverage.duplicates.length === 0,
		occurrences: model.coverage.occurrences,
		duplicates: model.coverage.duplicates,
		conflicts: model.coverage.conflicts
	};
	return {
		review: 'page20-stable-ocr-ids-v1',
		passed: Object.values(checks).every(Boolean) && coverage.passed && uniqueness.passed,
		checks,
		groups,
		bottomSequence,
		bottomPassages: positions,
		coverage,
		uniqueness,
		note: 'Offline ID membership and panel-order regression; not transcription, visual approval, structural validation or export.'
	};
}

export function scorePage20Files(
	requestFile,
	responseFile,
	expectedWordsSha256 = PAGE20_WORDS_SHA256
) {
	const files = [requestFile, responseFile].map((path) => {
		const bytes = readFileSync(path);
		return { path: resolve(path), bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
	});
	const [request, response] = files.map(({ bytes }) => JSON.parse(bytes.toString('utf8')));
	const wordsSha256 = createHash('sha256')
		.update(JSON.stringify(request.document.words))
		.digest('hex');
	if (wordsSha256 !== expectedWordsSha256)
		throw new Error(
			'Page 20 frozen OCR fingerprint mismatch; ordinal IDs alone do not identify this page'
		);
	const result = scorePage20(request, response);
	for (const file of files)
		if (createHash('sha256').update(readFileSync(file.path)).digest('hex') !== file.sha256)
			throw new Error(`Evidence changed during scoring: ${file.path}`);
	return {
		...result,
		wordsSha256,
		evidence: files.map(({ path, sha256 }) => ({ path, sha256 })),
		inputsUnchanged: true
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		if (process.argv.length !== 4)
			throw new Error(
				'Usage: node tools/vision-pilot/source-page20-regression.mjs REQUEST_JSON RESPONSE_JSON'
			);
		const result = scorePage20Files(...process.argv.slice(2));
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
	}
}
