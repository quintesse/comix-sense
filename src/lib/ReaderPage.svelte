<script lang="ts">
	import { untrack } from 'svelte';
	import ComicPage from './ComicPage.svelte';
	import type { PageImage } from './PageImages';
	import ComicBubble from './ComicBubble.svelte';
	import { BblShapeType, type Bubble, type Comic } from './types/Comic';
	import { svgPoint } from './types/funcs';

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
		if (!editable || !showBubbles || !container) return;
		const target = container;
		// End a drag when the displayed overlay changes.
		const overlay = bubbles;
		let stop = () => {};
		function start(event: MouseEvent) {
			if (
				!(event.button === 1 || (event.button === 0 && event.shiftKey)) ||
				!(event.target instanceof Element)
			)
				return;
			const hit = getBubble(event.target);
			const svg = event.target.closest('svg');
			if (!hit || !svg || !overlay.includes(hit.bubble)) return;
			event.preventDefault();
			event.stopPropagation();
			stop();
			const bubble = hit.bubble;
			const origin = svgPoint(svg, event);
			const vertices = bubble.shape.vs.map((v) => ({ ...v }));
			const button = event.button;
			if (
				document.activeElement instanceof HTMLElement &&
				document.activeElement.isContentEditable
			) {
				document.activeElement.blur();
			}
			activeBubble = bubble;
			function move(event: MouseEvent) {
				if (!(event.buttons & (button === 1 ? 4 : 1))) {
					stop();
					return;
				}
				event.preventDefault();
				const point = svgPoint(svg!, event);
				bubble.shape.vs = vertices.map((v) => ({
					...v,
					x: v.x + point.x - origin.x,
					y: v.y + point.y - origin.y
				}));
			}
			function up(event: MouseEvent) {
				if (event.button === button) stop();
			}
			stop = () => {
				document.removeEventListener('mousemove', move, true);
				document.removeEventListener('mouseup', up, true);
				window.removeEventListener('blur', stop);
			};
			document.addEventListener('mousemove', move, true);
			document.addEventListener('mouseup', up, true);
			window.addEventListener('blur', stop);
		}
		target.addEventListener('mousedown', start, true);
		return () => {
			stop();
			target.removeEventListener('mousedown', start, true);
		};
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
