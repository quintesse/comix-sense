import { asset } from '$app/paths';
import {
	archiveLimits,
	type ArchiveEntry,
	type ArchiveReader,
	type ArchivePriority
} from './ArchiveReader';
import { ArchiveBlobCache } from './ArchiveBlobCache';
import { ArchiveWorkQueue, type ArchiveTask } from './ArchiveWorkQueue';

const queue = new ArchiveWorkQueue();
const cache = new ArchiveBlobCache(archiveLimits.cacheBytes);
type Pending = { promise: Promise<Blob>; task: ArchiveTask<Blob>; priority: ArchivePriority };
export class LocalArchiveReader implements ArchiveReader {
	private inflight = new Map<string, Pending>();
	private reject?: (error: Error) => void;
	private generation = 0;
	private disposed = false;
	constructor(private file: File) {}
	private run<T>(path: string | undefined, priority: ArchivePriority): ArchiveTask<T> {
		const generation = this.generation;
		return queue.enqueue(this, priority, async () => {
			if (this.disposed || generation !== this.generation)
				throw new Error('Archive operation cancelled');
			return await new Promise<T>((resolve, reject) => {
				const worker = new Worker(new URL('./archive.worker.ts', import.meta.url), {
					type: 'module'
				});
				const finish = () => {
					clearTimeout(timer);
					worker.onmessage = null;
					worker.onerror = null;
					worker.terminate();
					this.reject = undefined;
				};
				this.reject = (error) => {
					finish();
					reject(error);
				};
				const timer = setTimeout(
					() => this.reject?.(new Error('Archive decoder exceeded 15 second limit')),
					archiveLimits.timeoutMs
				);
				worker.onmessage = ({ data }) => {
					finish();
					data.error ? reject(new Error(data.error)) : resolve(data.result);
				};
				worker.onerror = (event) => {
					event.preventDefault();
					finish();
					reject(new Error('Archive decoder failed: ' + event.message));
				};
				try {
					worker.postMessage({
						file: this.file,
						path,
						codecBase: new URL(asset('codecs/libarchive.js'), location.href).pathname.replace(
							/libarchive\.js$/,
							''
						)
					});
				} catch (error) {
					finish();
					reject(error);
				}
			});
		});
	}
	list() {
		return this.run<ArchiveEntry[]>(undefined, 'reader').promise;
	}
	read(path: string, priority: ArchivePriority = 'reader'): Promise<Blob> {
		if (this.disposed) return Promise.reject(new Error('Archive disposed'));
		const hit = cache.get(this, path, priority);
		if (hit) return Promise.resolve(hit);
		const existing = this.inflight.get(path);
		if (existing) {
			if (priority === 'reader') {
				existing.priority = priority;
				existing.task.promote();
			}
			return existing.promise;
		}
		const task = this.run<Blob>(path, priority),
			generation = this.generation;
		const pending: Pending = {
			task,
			priority,
			promise: task.promise.then((blob) => {
				if (this.disposed || generation !== this.generation)
					throw new Error('Archive operation cancelled');
				cache.put(this, path, blob, pending.priority);
				return blob;
			})
		};
		this.inflight.set(path, pending);
		const clear = () => {
			if (this.inflight.get(path) === pending) this.inflight.delete(path);
		};
		void pending.promise.then(clear, clear);
		return pending.promise;
	}
	protect(path: string): () => void {
		return this.disposed ? () => {} : cache.protect(this, path);
	}
	cancel() {
		this.generation++;
		queue.cancel(this);
		this.inflight.clear();
		this.reject?.(new Error('Archive operation cancelled'));
	}
	dispose() {
		this.disposed = true;
		this.cancel();
		cache.forget(this);
	}
}
