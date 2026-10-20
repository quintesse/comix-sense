/** Archive Blob leases held by renderer URLs, separately bounded from the extraction cache. */
const urls = new Map<string, Blob>();
const leases = new Map<Blob, number>();
let bytes = 0;
export const archiveImageBytes = 128 * 1024 * 1024;
export function archiveImageUrl(blob: Blob, type: string) {
	if (!leases.has(blob) && bytes + blob.size > archiveImageBytes)
		throw new Error('Archive image memory budget exceeded');
	const url = URL.createObjectURL(new Blob([blob], { type }));
	if (!leases.has(blob)) bytes += blob.size;
	leases.set(blob, (leases.get(blob) ?? 0) + 1);
	urls.set(url, blob);
	return url;
}
export function releaseImageUrl(url: string) {
	const blob = urls.get(url);
	if (blob) {
		urls.delete(url);
		const refs = leases.get(blob)! - 1;
		if (refs) leases.set(blob, refs);
		else {
			leases.delete(blob);
			bytes -= blob.size;
		}
	}
	URL.revokeObjectURL(url);
}
