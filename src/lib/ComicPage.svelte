<script lang="ts">
	import type { Snippet } from 'svelte';
	import ShapeEditor from './ShapeEditor.svelte';
	import { BblShapeType, type BblShape } from './types/Comic';

	let {
		img,
		width,
		height,
		editable = false,
		selectedShape = BblShapeType.box,
		children,
		onshape
	}: {
		img: string;
		width: number;
		height: number;
		editable?: boolean;
		selectedShape?: BblShapeType;
		children?: Snippet<[{ renderMode: string }]>;
		onshape?: (shape: BblShape) => void;
	} = $props();

	const id = $props.id();
	let svg = $state<SVGSVGElement>();
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
	<g class="svgcontent">
		{@render children?.({ renderMode: 'content' })}
		{@render children?.({ renderMode: 'handles' })}
	</g>
	{#if editable && svg}<ShapeEditor {svg} shape={selectedShape} {onshape} />{/if}
</svg>

<style>
	svg {
		user-select: none;
		display: block;
	}
</style>
