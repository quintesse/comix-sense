import { writable } from 'svelte/store';
import type { Bubble } from '../types/Comic';
import { relativePath } from './metadata';

type Backup = {
	id?: number;
	directory: FileSystemDirectoryHandle;
	documents: Record<string, string>;
	changedPages?: Record<string, string[]>;
	changedLanguages?: Record<string, Record<string, string[]>>;
	sources?: Record<string, string>;
};
type Draft = {
	raw: Record<string, any>;
	revision: number;
	pages: Set<string>;
	languages: Map<string, Set<string>>;
	source: string;
	legacy?: boolean;
};

// Only the envelope is application-specific. Each value is an ordinary .bbl document.
async function database<T>(
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open('comix-sense-bbl', 1);
		request.onupgradeneeded = () =>
			request.result.createObjectStore('workspaces', { keyPath: 'id', autoIncrement: true });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	try {
		return await new Promise<T>((resolve, reject) => {
			const transaction = db.transaction('workspaces', mode);
			const request = operation(transaction.objectStore('workspaces'));
			transaction.oncomplete = () => resolve(request.result);
			transaction.onabort = transaction.onerror = () => reject(transaction.error ?? request.error);
		});
	} finally {
		db.close();
	}
}

/** One directory's editable .bbl documents, shared by loose pages and lazy archives. */
export class BblWorkspace {
	readonly pending = writable(0);
	readonly pendingPages = writable<ReadonlySet<string>>(new Set());
	readonly pendingLanguages = writable<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
	readonly error = writable('');
	private id?: number;
	private drafts = new Map<string, Draft>();
	private savedDocuments = new Map<string, Record<string, any>>();
	private publishedPages = new Set<string>();
	private timer?: ReturnType<typeof setTimeout>;
	private writes = Promise.resolve();
	constructor(private directory: FileSystemDirectoryHandle) {}

	async restore() {
		try {
			const records = await database<Backup[]>('readonly', (store) => store.getAll());
			for (const record of records) {
				if (!(await this.directory.isSameEntry(record.directory))) continue;
				this.id = record.id;
				for (const [path, text] of Object.entries(record.documents)) {
					if (!relativePath(path) || !path.endsWith('.bbl')) continue;
					const raw = JSON.parse(text);
					if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages))
						throw new Error('Invalid browser backup: ' + path);
					this.drafts.set(path, {
						raw,
						revision: 0,
						pages: new Set(record.changedPages?.[path] ?? []),
						languages: new Map(
							Object.entries(record.changedLanguages?.[path] ?? {}).map(([page, languages]) => [
								page,
								new Set(languages)
							])
						),
						source: record.sources?.[path] ?? path,
						legacy: !record.changedLanguages?.[path]
					});
				}
				break;
			}
			this.publish();
		} catch (error) {
			this.error.set('Could not restore browser backups: ' + String(error));
		}
	}

	paths(): string[] {
		return [...this.drafts.keys()];
	}

	has(path: string): boolean {
		return this.drafts.has(path);
	}
	source(path: string): string | undefined {
		return this.drafts.get(path)?.source;
	}

	async read(path: string, original: () => Promise<string>): Promise<string> {
		const draft = this.drafts.get(path);
		const raw = draft?.raw ?? this.savedDocuments.get(path);
		return raw ? JSON.stringify(raw, null, 2) + '\n' : original();
	}

	// Older backups only identified documents; discovery can associate their pages.
	associatePage(path: string, pagePath: string, language: string) {
		const draft = this.drafts.get(path);
		if (draft?.legacy && !draft.languages.get(pagePath)?.has(language)) {
			draft.pages.add(pagePath);
			const languages = draft.languages.get(pagePath) ?? new Set<string>();
			languages.add(language);
			draft.languages.set(pagePath, languages);
			this.publish();
		}
	}

	edit(
		path: string,
		original: Record<string, any>,
		pageIndex: number,
		bubbles: Bubble[],
		pagePath: string,
		language: string,
		source = path
	) {
		if (!relativePath(path) || !path.endsWith('.bbl')) throw new Error('Invalid .bbl path');
		let draft = this.drafts.get(path);
		if (!draft) {
			draft = {
				raw: structuredClone(this.savedDocuments.get(path) ?? original),
				revision: 0,
				pages: new Set(),
				languages: new Map(),
				source
			};
			this.drafts.set(path, draft);
		}
		// Callers provide a plain snapshot; retain no editor proxies in storage.
		draft.raw.pages[pageIndex].bubbles = bubbles;
		draft.pages.add(pagePath);
		const languages = draft.languages.get(pagePath) ?? new Set<string>();
		languages.add(language);
		draft.languages.set(pagePath, languages);
		draft.revision++;
		this.changed();
	}

	private publish() {
		this.pending.set(this.drafts.size);
		const pages = new Set([...this.drafts.values()].flatMap((draft) => [...draft.pages]));
		if (
			pages.size !== this.publishedPages.size ||
			[...pages].some((path) => !this.publishedPages.has(path))
		) {
			this.publishedPages = pages;
			this.pendingPages.set(pages);
		}
		const languages = new Map<string, Set<string>>();
		for (const draft of this.drafts.values())
			for (const [page, values] of draft.languages) {
				const combined = languages.get(page) ?? new Set<string>();
				for (const language of values) combined.add(language);
				languages.set(page, combined);
			}
		this.pendingLanguages.set(languages);
	}

	private changed() {
		this.publish();
		clearTimeout(this.timer);
		// Serialize after a pause, not on every text input or pointer movement.
		this.timer = setTimeout(() => void this.flush().catch(() => {}), 750);
	}

	flush(): Promise<void> {
		clearTimeout(this.timer);
		this.timer = undefined;
		const documents = Object.fromEntries(
			[...this.drafts].map(([path, draft]) => [path, JSON.stringify(draft.raw, null, 2) + '\n'])
		);
		const changedPages = Object.fromEntries(
			[...this.drafts].map(([path, draft]) => [path, [...draft.pages]])
		);
		const changedLanguages = Object.fromEntries(
			[...this.drafts].map(([path, draft]) => [
				path,
				Object.fromEntries([...draft.languages].map(([page, languages]) => [page, [...languages]]))
			])
		);
		const sources = Object.fromEntries(
			[...this.drafts].map(([path, draft]) => [path, draft.source])
		);
		const write = this.writes
			.catch(() => {})
			.then(async () => {
				if (Object.keys(documents).length === 0) {
					if (this.id !== undefined) await database('readwrite', (store) => store.delete(this.id!));
					this.id = undefined;
					this.error.set('');
					return;
				}
				const record: Backup = {
					directory: this.directory,
					documents,
					changedPages,
					changedLanguages,
					sources
				};
				if (this.id !== undefined) record.id = this.id;
				this.id = Number(await database('readwrite', (store) => store.put(record)));
				this.error.set('');
			});
		this.writes = write.catch((error) => {
			this.error.set('Could not back up edits in this browser: ' + String(error));
			throw error;
		});
		return this.writes;
	}

	async save(path: string) {
		if (!this.drafts.has(path)) return;

		// Request permission directly from the Save button's user gesture.
		if ((await this.directory.requestPermission({ mode: 'readwrite' })) !== 'granted')
			throw new Error('Write permission was not granted. Your edits are still retained.');
		await this.flush().catch(() => {});
		const draft = this.drafts.get(path)!;
		const text = JSON.stringify(draft.raw, null, 2) + '\n';
		const revision = draft.revision;
		try {
			const parts = path.split('/');
			const name = parts.pop()!;
			let directory = this.directory;
			for (const part of parts)
				directory = await directory.getDirectoryHandle(part, { create: true });
			const handle = await directory.getFileHandle(name, { create: true });
			const writer = await handle.createWritable();
			try {
				await writer.write(text);
				await writer.close();
			} catch (error) {
				await writer.abort().catch(() => {});
				throw error;
			}
			this.savedDocuments.set(path, JSON.parse(text));
			if (this.drafts.get(path)?.revision === revision) this.drafts.delete(path);
		} finally {
			this.publish();
			await this.flush();
		}
	}

	async discard(path: string) {
		clearTimeout(this.timer);
		this.timer = undefined;
		await this.writes.catch(() => {});
		const draft = this.drafts.get(path);
		if (!draft) return;
		this.drafts.delete(path);
		try {
			await this.flush();
		} catch (error) {
			this.drafts.set(path, draft);
			throw error;
		}
		this.publish();
		this.error.set('');
	}

	dispose() {
		if (this.timer !== undefined) void this.flush().catch(() => {});
	}
}
