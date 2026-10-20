/** Hard limits shared by the browser client and its disposable decoder worker. */
export const archiveLimits = {
	zipInput: 512 * 1024 * 1024,
	rarInput: 32 * 1024 * 1024,
	rarDictionary: 64 * 1024 * 1024,
	entries: 10000,
	entryOutput: 32 * 1024 * 1024,
	rarDeclaredOutput: 128 * 1024 * 1024,
	cacheBytes: 64 * 1024 * 1024,
	timeoutMs: 15000
};
export interface ArchiveEntry {
	path: string;
	size: number;
}
export type ArchivePriority = 'reader' | 'thumbnail';
export interface ArchiveReader {
	list(): Promise<ArchiveEntry[]>;
	read(path: string, priority?: ArchivePriority): Promise<Blob>;
	protect(path: string): () => void;
	cancel(): void;
	dispose(): void;
}
/** Reject traversal, platform-specific paths and normalized aliases, even for ignored files. */
export function entryPath(path: string): string {
	const normalized = path.replaceAll('\\', '/').normalize('NFC');
	if (
		!normalized ||
		normalized.startsWith('/') ||
		/[\x00-\x1f:]/.test(normalized) ||
		normalized
			.replace(/\/$/, '')
			.split('/')
			.some((p) => !p || p === '.' || p === '..')
	)
		throw new Error('Unsafe archive entry path: ' + path);
	return normalized;
}
export function ignoredPath(path: string) {
	return path.split('/').some((p) => p === '__MACOSX' || p === '.DS_Store');
}
