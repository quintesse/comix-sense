import { test, expect } from '@playwright/test';

test('pixel merge runs in a worker, transfers buffers, snapshots proxies and cancels cleanly', async ({
	page
}) => {
	await page.goto('/');
	const result = await page.evaluate(async () => {
		const modulePath = '/src/lib/ocrMergeWorker.ts';
		const { mergeOcrForPage } = await import(/* @vite-ignore */ modulePath);
		const words = new Proxy(
			[
				{
					text: 'Left',
					lang: 'en',
					shape: {
						type: 'box',
						vs: [
							{ x: 50, y: 25 },
							{ x: 90, y: 45 }
						]
					}
				},
				{
					text: 'Right',
					lang: 'en',
					shape: {
						type: 'box',
						vs: [
							{ x: 100, y: 25 },
							{ x: 140, y: 45 }
						]
					}
				}
			],
			{}
		);
		const geometric = await mergeOcrForPage(words);
		const pixels = () => {
			const image = new ImageData(360, 240);
			image.data.fill(255);
			const frame = (l: number, t: number, r: number, b: number) => {
				for (let y = t; y < b; y++)
					for (let x = l; x < r; x++)
						if (x < l + 3 || x >= r - 3 || y < t + 3 || y >= b - 3) {
							const i = (y * 360 + x) * 4;
							image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
						}
			};
			frame(10, 10, 95, 85);
			frame(95, 10, 180, 85);
			return image;
		};
		const data = pixels();
		const changed = await mergeOcrForPage(words, data);
		const controller = new AbortController();
		const pending = mergeOcrForPage(words, pixels(), controller.signal);
		controller.abort();
		const aborted = await pending.then(
			() => false,
			(e: Error) => e.name === 'AbortError'
		);
		const alreadyAborted = await mergeOcrForPage(words, undefined, controller.signal).then(
			() => false,
			(e: Error) => e.name === 'AbortError'
		);
		// A cancelled job must not poison a subsequent independent worker.
		const retry = await mergeOcrForPage(words, pixels());
		return {
			geometric: geometric.map((b: { text: string }) => b.text),
			changed: changed.map((b: { text: string }) => b.text),
			retry: retry.map((b: { text: string }) => b.text),
			detached: data.data.buffer.byteLength,
			aborted,
			alreadyAborted,
			sourceLength: words.length
		};
	});
	expect(result.geometric).toHaveLength(1);
	expect(result.changed).toEqual(['Left', 'Right']);
	expect(result.retry).toEqual(result.changed);
	expect(result.detached).toBe(0);
	expect(result.aborted).toBe(true);
	expect(result.alreadyAborted).toBe(true);
	expect(result.sourceLength).toBe(2);
});
test('inclination groups tilted words with or without artwork', async ({ page }) => {
	await page.goto('/');
	const results = await page.evaluate(async () => {
		const modulePath = '/src/lib/ocrMergeWorker.ts';
		const { mergeOcrForPage } = await import(/* @vite-ignore */ modulePath);
		const angle = Math.PI / 8;
		function word(text: string, left: number, top: number, width: number) {
			const vs = [
				[left, top],
				[left + width, top],
				[left + width, top + 18],
				[left, top + 18]
			].map(([x, y]) => ({
				x: 100 + x * Math.cos(angle) - y * Math.sin(angle),
				y: 100 + x * Math.sin(angle) + y * Math.cos(angle)
			}));
			return { text, shape: { type: 'poly', vs } };
		}
		const words = [
			word('first', 0, 0, 38),
			word('line', 46, 0, 28),
			word('second', 0, 27, 38),
			word('row', 46, 27, 28)
		];
		const outcomes = [];
		for (const boundaries of [false, true]) {
			for (const inclination of [false, true]) {
				const pixels = boundaries ? new ImageData(300, 250) : undefined;
				pixels?.data.fill(255);
				const bubbles = await mergeOcrForPage(words, pixels, undefined, inclination);
				outcomes.push(bubbles.map((bubble: { text: string }) => bubble.text));
			}
		}
		return outcomes;
	});
	expect(results[0]).not.toEqual(['first line second row']);
	expect(results[1]).toEqual(['first line second row']);
	expect(results[2]).toEqual(results[0]);
	expect(results[3]).toEqual(results[1]);
});
