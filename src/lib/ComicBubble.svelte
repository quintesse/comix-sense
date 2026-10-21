<script lang="ts">
	import DragHandle from './DragHandle.svelte';
	import { bounds, points, type Bubble, BblShapeType } from './types/Comic';
	import type { StrStrMap } from './types/funcs';

	interface Props {
		bubble: Bubble;
		editable?: boolean;
		renderMode?: string;
		bubbleIndex?: number;
	}

	let {
		bubble = $bindable(),
		editable = false,
		renderMode = 'normal',
		bubbleIndex
	}: Props = $props();

	function styleString(style: StrStrMap | undefined): string {
		return Object.entries(style || {})
			.map((e) => e[0] + ':' + e[1] + ';')
			.join('');
	}

	let cursor = $derived(bubble.shape.type === BblShapeType.box ? 'nw-resize' : 'move');
	let shapeStyle = $derived(styleString(bubble.style));
	let bb = $derived(bounds(bubble.shape.vs));
</script>

{#if renderMode === 'normal' || renderMode === 'shapes' || renderMode === 'clippath'}
	{#if bubble.shape.type === BblShapeType.box}
		<rect x={bb.x1} y={bb.y1} width={bb.w} height={bb.h} class="bubble" style={shapeStyle}>
			{#if bubble.text && renderMode !== 'clippath'}
				<title>{bubble.text}</title>
			{/if}
		</rect>
	{:else if bubble.shape.type === BblShapeType.poly}
		<polygon points={points(bubble.shape.vs)} class="bubble" style={shapeStyle}>
			{#if bubble.text && renderMode !== 'clippath'}
				<title>{bubble.text}</title>
			{/if}
		</polygon>
	{/if}
{/if}

{#if renderMode === 'normal' || renderMode === 'text'}
	<foreignObject data-bubble-index={bubbleIndex} x={bb.x1} y={bb.y1} width={bb.w} height={bb.h}>
		{#if editable}
			<div
				title={bubble.text}
				role="textbox"
				aria-label="Bubble text"
				contenteditable="true"
				bind:textContent={bubble.text}
			></div>
		{:else}
			<div title={bubble.text}>{bubble.text}</div>
		{/if}
	</foreignObject>
{/if}

{#if editable && (renderMode === 'normal' || renderMode === 'handles')}
	{#each bubble.shape.vs as v, i}
		<DragHandle bind:shape={bubble.shape} index={i} style={'cursor:' + cursor} />
	{/each}
{/if}

<style>
	.bubble {
		fill: white;
		opacity: 0.8;
	}

	foreignObject {
		overflow: visible;
		user-select: text;
	}

	foreignObject div {
		font-size: 18pt;
		line-height: 100%;
		overflow: visible;
		width: 100%;
		height: 100%;
		word-wrap: break-word;
		word-break: break-word;
		white-space: normal;
		text-align: center;
	}
</style>
