import type { ArchivePriority } from './ArchiveReader';

type Entry = { owner: object; path: string; blob: Blob; priority: ArchivePriority };

/** Session cache of encoded entry data. Display URLs have their own lifetime. */
export class ArchiveBlobCache {
	private owners = new Map<object, Map<string, Entry>>();
	private lru = new Set<Entry>();
	private pins = new Map<object, Map<string, number>>();
	private bytes = 0;
	constructor(private readonly budget: number) {}

	get(owner: object, path: string, priority: ArchivePriority): Blob | undefined {
		const entry = this.owners.get(owner)?.get(path);
		if (!entry) return;
		if (priority === 'reader') entry.priority = priority;
		this.lru.delete(entry);
		this.lru.add(entry);
		return entry.blob;
	}

	put(owner: object, path: string, blob: Blob, priority: ArchivePriority): void {
		if (blob.size > this.budget) return;
		const previous = this.owners.get(owner)?.get(path);
		let required = this.bytes - (previous?.blob.size ?? 0) + blob.size - this.budget;
		// Stable sorting preserves least-recently-used order within each tier.
		const tier = (entry: Entry) =>
			entry.priority === 'thumbnail' ? 0 : this.pins.has(entry.owner) ? 2 : 1;
		const candidates =
			required <= 0
				? []
				: [...this.lru]
						.filter((entry) => entry !== previous && !this.pins.get(entry.owner)?.has(entry.path))
						.sort((a, b) => tier(a) - tier(b));
		const victims: Entry[] = [];
		for (const entry of candidates) {
			if (required <= 0) break;
			victims.push(entry);
			required -= entry.blob.size;
		}
		// A protected spread can fill the cache. Still return/display the new Blob,
		// but skip caching it instead of exceeding the budget or dropping pinned data.
		if (required > 0) return;
		for (const entry of victims) this.remove(entry);
		if (previous) this.remove(previous);
		const entry = { owner, path, blob, priority };
		let entries = this.owners.get(owner);
		if (!entries) this.owners.set(owner, (entries = new Map()));
		entries.set(path, entry);
		this.lru.add(entry);
		this.bytes += blob.size;
	}

	protect(owner: object, path: string): () => void {
		let paths = this.pins.get(owner);
		if (!paths) this.pins.set(owner, (paths = new Map()));
		paths.set(path, (paths.get(path) ?? 0) + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const current = this.pins.get(owner);
			if (!current) return;
			const count = (current.get(path) ?? 0) - 1;
			if (count > 0) current.set(path, count);
			else current.delete(path);
			if (!current.size) this.pins.delete(owner);
		};
	}

	forget(owner: object) {
		for (const entry of this.owners.get(owner)?.values() ?? []) this.remove(entry);
		this.pins.delete(owner);
	}
	private remove(entry: Entry) {
		this.lru.delete(entry);
		const entries = this.owners.get(entry.owner)!;
		entries.delete(entry.path);
		if (!entries.size) this.owners.delete(entry.owner);
		this.bytes -= entry.blob.size;
	}
}
