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

	export function getBubble(target: Element) {
		if (!container?.contains(target)) return;
		const index = target.closest('foreignObject')?.getAttribute('data-bubble-index');
		if (index != null) return { bubble: bubbles[Number(index)], bubbles };
	}

	$effect(() => {
		const page = comic;
		const lang = language;
		bubbles = loadedBubbles;
		untrack(() => page.setBubbles(lang, bubbles));
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
				{#each bubbles as bubble, i (bubble)}
					<ComicBubble
						font={comic.textFont(language, bubble)}
						bind:bubble={bubbles[i]}
						bubbleIndex={i}
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
