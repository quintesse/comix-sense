<script lang="ts">
	import type { Snippet } from 'svelte';
	import ShapeEditor from './ShapeEditor.svelte';
	import { BblShapeType, type BblShape } from './types/Comic';

	let {
		img,
		editable = false,
		selectedShape = BblShapeType.box,
		children,
		onshape
	}: {
		img: string;
		editable?: boolean;
		selectedShape?: BblShapeType;
		children?: Snippet<[{ renderMode: string }]>;
		onshape?: (shape: BblShape) => void;
	} = $props();

	const id = $props.id();
	let svg = $state<SVGSVGElement>();
	let width = $state(0);
	let height = $state(0);

	$effect(() => {
		const image = new Image();
		let cancelled = false;
		image.onload = () => {
			if (!cancelled) {
				width = image.naturalWidth;
				height = image.naturalHeight;
			}
		};
		image.src = img;
		return () => {
			cancelled = true;
			image.onload = null;
		};
	});
</script>

<svg bind:this={svg} {width} {height} aria-label="Comic page" role="img">
	<defs>
		<filter id="{id}-blurry" x="0%" y="0%" height="100%" width="100%">
			<feGaussianBlur stdDeviation="5" in="SourceGraphic" />
		</filter>
		<clipPath id="{id}-clip">{@render children?.({ renderMode: 'clippath' })}</clipPath>
	</defs>
	<image href={img} {width} {height} />
	<image href={img} {width} {height} filter="url(#{id}-blurry)" clip-path="url(#{id}-clip)" />
	<g id="svgcontent">{@render children?.({ renderMode: 'normal' })}</g>
	{#if editable && svg}<ShapeEditor {svg} shape={selectedShape} {onshape} />{/if}
</svg>

<style>
	svg {
		user-select: none;
		display: block;
	}
</style>
