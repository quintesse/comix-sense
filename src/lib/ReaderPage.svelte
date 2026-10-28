<script lang="ts">
	import { untrack } from 'svelte';
	import ComicPage from './ComicPage.svelte';
	import type { PageImage } from './PageImages';
	import ComicBubble from './ComicBubble.svelte';
	import {
		BblShapeType,
		separateText,
		convertMask,
		validLayout,
		type Bubble,
		type Comic
	} from './types/Comic';
	import { svgPoint } from './types/funcs';
	import type { Font, FontScope, Face } from './bbl/metadata';

	let {
		comic,
		language,
		image,
		loadedBubbles,
		showBubbles = true,
		showBubbleText = true,
		editable,
		selectedShape,
		onfontselect
	}: {
		comic: Comic;
		language: string;
		image: PageImage;
		loadedBubbles: Bubble[];
		showBubbles?: boolean;
		showBubbleText?: boolean;
		editable: boolean;
		selectedShape: BblShapeType;
		onfontselect?: () => void;
	} = $props();
	let container: HTMLDivElement;
	let bubbles = $state<Bubble[]>([]);
	let activeBubble = $state<Bubble>();
	let geometryPart = $state<'text' | 'mask'>('mask');
	let typographyRevision = $derived(comic.typographyRevision);
	let bubbleFonts = $derived.by(() => {
		$typographyRevision;
		return new Map(bubbles.map((bubble) => [bubble, comic.textFont(language, bubble)]));
	});

	export function pagePath() {
		return comic.path;
	}
	export function fontTarget(scope: FontScope) {
		$typographyRevision;
		return {
			bubble: scope === 'bubble' ? activeBubble : undefined,
			part: geometryPart,
			font:
				scope === 'album'
					? comic.albumFont(language)
					: scope === 'page'
						? comic.pageFont(language)
						: (activeBubble?.font ?? {}),
			defaults: scope === 'album' ? {} : comic.defaultFont(language),
			families: comic.fontFamilies(language),
			faces: comic.fontFaces(language, scope),
			faceKey: `${scope === 'album' ? comic.albumPath : comic.path}:${language}:${scope}`,
			disabled: language === 'org' || (scope === 'bubble' && !activeBubble)
		};
	}
	export async function setFont(scope: FontScope, font: Font) {
		if (!editable || language === 'org') return;
		if (scope === 'album') {
			await comic.editAlbumFont(font);
		} else if (scope === 'bubble') {
			if (activeBubble) activeBubble.font = font;
		} else {
			await comic.editBubbles(language, $state.snapshot(bubbles), font);
		}
	}
	export function activateBubble(bubble: Bubble) {
		if (activeBubble !== bubble) geometryPart = 'mask';
		activeBubble = bubble;
		onfontselect?.();
	}
	export function setAppearance(changes: Record<string, string>) {
		if (editable && language !== 'org' && activeBubble)
			activeBubble.style = { ...activeBubble.style, ...changes };
	}
	export function geometry(action: 'separate' | 'link' | 'text' | 'mask' | 'box' | 'poly') {
		if (!editable || !activeBubble) return;
		if (action === 'separate') {
			if (separateText(activeBubble)) geometryPart = 'text';
		} else if (action === 'link') {
			delete activeBubble.layout;
			geometryPart = 'text';
		} else if (action === 'text' || action === 'mask') geometryPart = action;
		else convertMask(activeBubble, action === 'box' ? BblShapeType.box : BblShapeType.poly);
	}
	export async function setFontFaces(scope: FontScope, faces: Face[]) {
		if (editable && language !== 'org' && scope !== 'bubble')
			await comic.editFontFaces(language, scope, faces);
	}
	$effect(() => {
		const lang = language;
		const page = comic;
		const fonts = bubbles.map((bubble) => $state.snapshot(bubble.font));
		untrack(
			() =>
				void page.refreshTypography(
					lang,
					fonts.map((font) => ({ font }))
				)
		);
	});
	let indexedBubbles = $derived(bubbles.map((bubble, index) => ({ bubble, index })));
	let orderedBubbles = $derived(
		indexedBubbles.toSorted(
			(a, b) => Number(a.bubble === activeBubble) - Number(b.bubble === activeBubble)
		)
	);

	$effect(() => {
		if (!editable || !showBubbles || (activeBubble && !bubbles.includes(activeBubble))) {
			activeBubble = undefined;
			geometryPart = 'mask';
		}
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
				pointIndex:
					element?.closest('[data-geometry]')?.getAttribute('data-geometry') === 'Text area'
						? undefined
						: pointIndex != null
							? Number(pointIndex)
							: undefined,
				part:
					element?.closest('[data-geometry]')?.getAttribute('data-geometry') === 'Text area' ||
					(bubbles[Number(index)].layout !== undefined && target.closest('foreignObject'))
						? 'text'
						: 'mask'
			};
	}

	function deselectOutside(event: MouseEvent) {
		if (!activeBubble || !(event.target instanceof Element)) return;
		if (event.target.closest('[data-font-settings], [data-font-settings-toggle], [role=menu]'))
			return;
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
			const layout = validLayout(bubble.layout)
				? bubble.layout.vs.map((v) => ({ ...v }))
				: undefined;
			const button = event.button;
			if (
				document.activeElement instanceof HTMLElement &&
				document.activeElement.isContentEditable
			) {
				document.activeElement.blur();
			}
			activateBubble(bubble);
			function move(event: MouseEvent) {
				if (!(event.buttons & (button === 1 ? 4 : 1))) {
					stop();
					return;
				}
				event.preventDefault();
				const point = svgPoint(svg!, event);
				if (layout && validLayout(bubble.layout))
					bubble.layout.vs = layout.map((v) => ({
						x: v.x + point.x - origin.x,
						y: v.y + point.y - origin.y
					})) as [(typeof layout)[number], (typeof layout)[number]];
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
		geometryPart = 'mask';
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
						font={bubbleFonts.get(bubble)}
						bind:bubble={bubbles[index]}
						bubbleIndex={index}
						active={bubble === activeBubble}
						onactivate={() => activateBubble(bubble)}
						part={geometryPart}
						onpart={(part) => {
							activateBubble(bubble);
							geometryPart = part;
						}}
						{renderMode}
						showText={showBubbleText}
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
