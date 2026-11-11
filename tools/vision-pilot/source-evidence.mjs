import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const evidenceHash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
export const readEvidence = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Verify a preparation, retaining compatibility with manifests created before freeze files. */
export function sourceEvidence(
	manifestFile,
	freezeFile = resolve(dirname(manifestFile), 'freeze.json')
) {
	const manifest = readEvidence(manifestFile);
	if (manifest.schemaVersion !== 1 || manifest.stage !== 'source-grouping-v1')
		throw new Error('Invalid source manifest');
	const requestFile = resolve(dirname(manifestFile), 'source-request.json');
	const checks = new Map([
		[manifest.page.image, manifest.page.imageSha256],
		[manifest.page.ocr, manifest.page.ocrSha256]
	]);
	const frozen = existsSync(freezeFile);
	if (frozen) {
		const freeze = readEvidence(freezeFile);
		checks.set(manifestFile, freeze.manifestSha256);
		checks.set(requestFile, freeze.requestSha256);
		if (
			freeze.inputHashes?.image !== manifest.page.imageSha256 ||
			freeze.inputHashes?.ocr !== manifest.page.ocrSha256
		)
			throw new Error('Frozen input fingerprints differ from manifest');
	}
	for (const [file, expected] of checks)
		if (evidenceHash(file) !== expected) throw new Error(`Frozen evidence hash mismatch: ${file}`);
	const files = [manifestFile, requestFile, ...checks.keys(), ...(frozen ? [freezeFile] : [])];
	return {
		manifest,
		requestFile,
		frozen,
		hashes: new Map([...new Set(files)].map((file) => [file, evidenceHash(file)]))
	};
}
