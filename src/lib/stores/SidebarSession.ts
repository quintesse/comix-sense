export interface SidebarSession {
	directory: FileSystemDirectoryHandle;
	expandedIds: string[];
}

export interface ReadingPosition {
	directory: FileSystemDirectoryHandle;
	lastPage?: string;
	albumPages: Record<string, string>;
}

// Directory handles must be stored in IndexedDB to retain their browser permissions.
async function sessionStore<T>(
	mode: IDBTransactionMode,
	request: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const open = indexedDB.open('comix-sense', 1);
		open.onupgradeneeded = () => open.result.createObjectStore('sidebar');
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
	try {
		return await new Promise<T>((resolve, reject) => {
			const transaction = database.transaction('sidebar', mode);
			const operation = request(transaction.objectStore('sidebar'));
			transaction.oncomplete = () => resolve(operation.result);
			transaction.onabort = () => reject(transaction.error ?? operation.error);
			transaction.onerror = () => reject(transaction.error ?? operation.error);
		});
	} finally {
		database.close();
	}
}

export function readSidebarSession(): Promise<SidebarSession | undefined> {
	return sessionStore('readonly', (store) => store.get('session'));
}

export function saveSidebarSession(session: SidebarSession): Promise<IDBValidKey> {
	return sessionStore('readwrite', (store) => store.put(session, 'session'));
}

export function readReadingHistory(): Promise<ReadingPosition[] | undefined> {
	return sessionStore('readonly', (store) => store.get('readingHistory'));
}

export function saveReadingHistory(history: ReadingPosition[]): Promise<IDBValidKey> {
	return sessionStore('readwrite', (store) => store.put(history, 'readingHistory'));
}
