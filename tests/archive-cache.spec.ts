import { test, expect } from '@playwright/test';
import { ArchiveBlobCache } from '../src/lib/archives/ArchiveBlobCache';
import { ArchiveWorkQueue } from '../src/lib/archives/ArchiveWorkQueue';
const blob = (bytes: number) => new Blob([new Uint8Array(bytes)]);

test('cache evicts individual LRU entries, refreshes hits, and isolates roots', () => {
	const cache = new ArchiveBlobCache(12),
		a = {},
		b = {};
	const first = blob(4),
		second = blob(4),
		third = blob(4);
	cache.put(a, 'same', first, 'reader');
	cache.put(a, '2', second, 'reader');
	cache.put(b, 'same', third, 'reader');
	expect(cache.get(a, 'same', 'reader')).toBe(first);
	cache.put(a, '4', blob(4), 'reader');
	expect(cache.get(a, '2', 'reader')).toBeUndefined();
	expect(cache.get(b, 'same', 'reader')).toBe(third);
	expect(cache.get(a, 'same', 'reader')).toBe(first);
	cache.forget(a);
	expect(cache.get(b, 'same', 'reader')).toBe(third);
});

test('cache prefers thumbnails and inactive album data while preserving protected entries', () => {
	const cache = new ArchiveBlobCache(12),
		active = {},
		inactive = {};
	const release = cache.protect(active, 'display');
	cache.put(active, 'display', blob(4), 'reader');
	cache.put(active, 'thumb', blob(4), 'thumbnail');
	cache.put(inactive, 'previous', blob(4), 'reader');
	cache.put(active, 'next', blob(4), 'reader');
	expect(cache.get(active, 'thumb', 'thumbnail')).toBeUndefined();
	expect(cache.get(inactive, 'previous', 'reader')).toBeDefined();
	cache.put(active, 'later', blob(4), 'reader');
	expect(cache.get(inactive, 'previous', 'reader')).toBeUndefined();
	expect(cache.get(active, 'next', 'reader')).toBeDefined();
	expect(cache.get(active, 'display', 'reader')).toBeDefined();
	release();
});

test('protection is reference counted and oversized protected spreads never exceed cache budget', () => {
	const cache = new ArchiveBlobCache(8),
		owner = {};
	const a = cache.protect(owner, 'a'),
		alsoA = cache.protect(owner, 'a'),
		b = cache.protect(owner, 'b');
	cache.put(owner, 'a', blob(4), 'reader');
	cache.put(owner, 'b', blob(4), 'reader');
	a();
	a();
	cache.put(owner, 'c', blob(4), 'reader');
	expect(cache.get(owner, 'c', 'reader')).toBeUndefined();
	expect(cache.get(owner, 'a', 'reader')).toBeDefined();
	expect(cache.get(owner, 'b', 'reader')).toBeDefined();
	alsoA();
	cache.put(owner, 'c', blob(4), 'reader');
	expect(cache.get(owner, 'a', 'reader')).toBeUndefined();
	expect(cache.get(owner, 'c', 'reader')).toBeDefined();
	cache.put(owner, 'too-large', blob(9), 'reader');
	expect(cache.get(owner, 'too-large', 'reader')).toBeUndefined();
	b();
	cache.forget(owner);
	expect(cache.get(owner, 'b', 'reader')).toBeUndefined();
});

test('queue prioritizes foreground work, promotes shared thumbnails, and cancels queued jobs', async () => {
	const queue = new ArchiveWorkQueue(),
		owner = {},
		cancelledOwner = {},
		order: string[] = [];
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const first = queue.enqueue(owner, 'thumbnail', async () => {
		order.push('running');
		await gate;
	});
	await Promise.resolve();
	const oldThumb = queue.enqueue(owner, 'thumbnail', async () => {
		order.push('old thumbnail');
	});
	const shared = queue.enqueue(owner, 'thumbnail', async () => {
		order.push('promoted');
	});
	shared.promote();
	const reader = queue.enqueue(owner, 'reader', async () => {
		order.push('reader');
	});
	const cancelled = queue.enqueue(cancelledOwner, 'reader', async () => {
		throw new Error('Should never start');
	});
	const cancellation = expect(cancelled.promise).rejects.toThrow('cancelled');
	queue.cancel(cancelledOwner);
	release();
	await Promise.all([
		first.promise,
		oldThumb.promise,
		shared.promise,
		reader.promise,
		cancellation
	]);
	expect(order).toEqual(['running', 'promoted', 'reader', 'old thumbnail']);
	const failed = queue.enqueue(owner, 'reader', async () => {
		throw new Error('bad archive');
	});
	await expect(failed.promise).rejects.toThrow('bad archive');
	await expect(queue.enqueue(owner, 'reader', async () => 42).promise).resolves.toBe(42);
});
