import type { ArchivePriority } from './ArchiveReader';

export interface ArchiveTask<T> {
	promise: Promise<T>;
	promote(): void;
}
type Job = {
	owner: object;
	priority: ArchivePriority;
	run(): Promise<void>;
	reject(error: Error): void;
};

/** One active decoder; queued foreground work goes ahead of thumbnails. */
export class ArchiveWorkQueue {
	private jobs: Job[] = [];
	private running = false;

	enqueue<T>(owner: object, priority: ArchivePriority, start: () => Promise<T>): ArchiveTask<T> {
		let job: Job;
		const promise = new Promise<T>((resolve, reject) => {
			job = {
				owner,
				priority,
				reject,
				run: async () => {
					try {
						resolve(await start());
					} catch (error) {
						reject(error);
					} finally {
						this.running = false;
						this.pump();
					}
				}
			};
			this.jobs.push(job);
		});
		// Collect requests from the same turn before choosing which decoder to start.
		queueMicrotask(() => this.pump());
		return {
			promise,
			promote: () => {
				job.priority = 'reader';
			}
		};
	}

	cancel(owner: object) {
		const cancelled = this.jobs.filter((job) => job.owner === owner);
		this.jobs = this.jobs.filter((job) => job.owner !== owner);
		for (const job of cancelled) job.reject(new Error('Archive operation cancelled'));
	}
	private pump() {
		if (this.running || !this.jobs.length) return;
		const index = this.jobs.findIndex((job) => job.priority === 'reader');
		const job = this.jobs.splice(index < 0 ? 0 : index, 1)[0];
		this.running = true;
		void job.run();
	}
}
