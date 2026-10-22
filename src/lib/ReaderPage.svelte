<script lang="ts">
	import { untrack } from 'svelte';
	import ComicPage from './ComicPage.svelte';
	import type { PageImage } from './PageImages';
	import ComicBubble from './ComicBubble.svelte';
	import { BblShapeType, type Bubble, type Comic } from './types/Comic';

	let {
		comic,
		language,
		image,
		loadedBubbles,
		showBubbles = true,
		editable,
		selectedShape
	}: {
		comic: Comic;
		language: string;
		image: PageImage;
		loadedBubbles: Bubble[];
		showBubbles?: boolean;
		editable: boolean;
		selectedShape: BblShapeType;
	} = $props();
	let container: HTMLDivElement;
	let bubbles = $state<Bubble[]>([]);
	let activeBubble = $state<Bubble>();
	let indexedBubbles = $derived(bubbles.map((bubble, index) => ({ bubble, index })));
	let orderedBubbles = $derived(
		indexedBubbles.toSorted(
			(a, b) => Number(a.bubble === activeBubble) - Number(b.bubble === activeBubble)
		)
	);

	$effect(() => {
		if (!editable || !showBubbles) activeBubble = undefined;
	});

	export function getBubble(target: Element) {
		if (!container?.contains(target)) return;
		const element = target.closest('[data-bubble-index]');
		const index = element?.getAttribute('data-bubble-index');
		const pointIndex = element?.getAttribute('data-point-index');
		if (index != null)
			return {
				bubble: bubbles[Number(index)],
				bubbles,
				pointIndex: pointIndex != null ? Number(pointIndex) : undefined
			};
	}

	function deselectOutside(event: MouseEvent) {
		if (!activeBubble || !(event.target instanceof Element)) return;
		if (getBubble(event.target)?.bubble === activeBubble) return;
		const editor = document.activeElement;
		if (editor instanceof HTMLElement && container.contains(editor) && editor.isContentEditable) {
			const selection = window.getSelection();
			if (selection && editor.contains(selection.anchorNode)) selection.removeAllRanges();
			editor.blur();
		}
		activeBubble = undefined;
	}

	$effect(() => {
		// Run before drawing or handle dragging can prevent the browser's focus change.
		document.addEventListener('mousedown', deselectOutside, true);
		return () => document.removeEventListener('mousedown', deselectOutside, true);
	});

	$effect(() => {
		const page = comic;
		const lang = language;
		bubbles = loadedBubbles;
		activeBubble = undefined;
		untrack(() => page.setBubbles(lang, bubbles));
		let initial = true;
		$effect(() => {
			const snapshot = $state.snapshot(bubbles);
			if (initial) {
				initial = false;
				return;
			}
			untrack(() => void page.editBubbles(lang, snapshot).catch(console.error));
		});
	});
</script>

<div bind:this={container} data-page-path={comic.path}>
	<ComicPage
		img={image.url}
		width={image.width}
		height={image.height}
		editable={editable && showBubbles}
		{selectedShape}
		onshape={(shape) => bubbles.push({ text: '', shape })}
	>
		{#snippet children({ renderMode })}
			{#if showBubbles}
				{#each orderedBubbles as { bubble, index } (bubble)}
					<ComicBubble
						font={comic.textFont(language, bubble)}
						bind:bubble={bubbles[index]}
						bubbleIndex={index}
						active={bubble === activeBubble}
						onactivate={() => (activeBubble = bubble)}
						{renderMode}
						{editable}
					/>
				{/each}
			{/if}
		{/snippet}
	</ComicPage>
</div>

<style>
	div {
		flex: none;
	}
</style>
