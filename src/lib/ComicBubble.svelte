<script lang="ts">
	import { tick } from 'svelte';
	import { textStyle } from './bbl/FontResources';
	import type { Font } from './bbl/metadata';
	import BubbleGeometry from './BubbleGeometry.svelte';
	import DragHandle from './DragHandle.svelte';
	import PolygonEdges from './PolygonEdges.svelte';
	import {
		bounds,
		textBounds,
		validLayout,
		points,
		type Bubble,
		type BblLayout,
		BblShapeType
	} from './types/Comic';
	import { cornerRadius, boxRadius, maskStyle, roundedPolygon } from './maskAppearance';

	interface Props {
		bubble: Bubble;
		editable?: boolean;
		showText?: boolean;
		renderMode?: string;
		bubbleIndex?: number;
		font?: Font;
		active?: boolean;
		onactivate?: () => void;
		part?: 'text' | 'mask';
		onpart?: (part: 'text' | 'mask') => void;
	}

	let {
		bubble = $bindable(),
		editable = false,
		showText = true,
		renderMode = 'normal',
		bubbleIndex,
		font = {},
		active = false,
		onactivate,
		part = 'mask',
		onpart
	}: Props = $props();

	async function activateEditor(event: FocusEvent) {
		const editor = event.currentTarget as HTMLDivElement;
		const selection = window.getSelection();
		const range =
			selection?.rangeCount && editor.contains(selection.anchorNode)
				? selection.getRangeAt(0).cloneRange()
				: document.createRange();
		if (!editor.contains(range.commonAncestorContainer)) {
			range.selectNodeContents(editor);
			range.collapse(false);
		}
		const { startContainer, startOffset, endContainer, endOffset } = range;
		onactivate?.();
		onpart?.('text');
		await tick();
		// SVG reordering can blur the editor; retain its focus and caret after raising it.
		if (!editor.isConnected || !active || document.activeElement === editor) return;
		editor.focus({ preventScroll: true });
		range.setStart(startContainer, startOffset);
		range.setEnd(endContainer, endOffset);
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	function selectMask(node: SVGElement) {
		function down() {
			if (editable) {
				onpart?.('mask');
				onactivate?.();
			}
		}
		node.addEventListener('mousedown', down);
		return {
			destroy() {
				node.removeEventListener('mousedown', down);
			}
		};
	}

	let cursor = $derived(bubble.shape.type === BblShapeType.box ? 'nw-resize' : 'move');
	let shapeStyle = $derived(renderMode === 'clippath' ? '' : maskStyle(bubble.style));
	let radius = $derived(cornerRadius(bubble.style));
	let bb = $derived(bounds(bubble.shape.vs));
	let tb = $derived(textBounds(bubble));
</script>

{#if renderMode === 'normal' || renderMode === 'content' || renderMode === 'shapes' || renderMode === 'clippath'}
	{#if bubble.shape.type === BblShapeType.box}
		<rect
			data-bubble-index={bubbleIndex}
			use:selectMask
			x={bb.x1}
			y={bb.y1}
			width={bb.w}
			height={bb.h}
			rx={boxRadius(bubble.shape.vs, radius)}
			ry={boxRadius(bubble.shape.vs, radius)}
			class="bubble"
			style={shapeStyle}
		>
			{#if bubble.text && renderMode !== 'clippath'}
				<title>{bubble.text}</title>
			{/if}
		</rect>
	{:else if bubble.shape.type === BblShapeType.poly && radius > 0}
		<path
			data-bubble-index={bubbleIndex}
			use:selectMask
			d={roundedPolygon(bubble.shape.vs, radius)}
			class="bubble"
			style={shapeStyle}
		>
			{#if bubble.text && renderMode !== 'clippath'}<title>{bubble.text}</title>{/if}
		</path>
	{:else if bubble.shape.type === BblShapeType.poly}
		<polygon
			data-bubble-index={bubbleIndex}
			use:selectMask
			points={points(bubble.shape.vs)}
			class="bubble"
			style={shapeStyle}
		>
			{#if bubble.text && renderMode !== 'clippath'}
				<title>{bubble.text}</title>
			{/if}
		</polygon>
	{/if}
{/if}

{#if showText && (renderMode === 'normal' || renderMode === 'content' || renderMode === 'text')}
	<foreignObject data-bubble-index={bubbleIndex} x={tb.x1} y={tb.y1} width={tb.w} height={tb.h}>
		{#if editable}
			<div
				title={bubble.text}
				style={textStyle(font)}
				role="textbox"
				tabindex="0"
				aria-label="Bubble text"
				contenteditable="true"
				bind:textContent={bubble.text}
				onfocus={activateEditor}
				onclick={() => {
					onactivate?.();
					onpart?.('text');
				}}
				onkeydown={() => {
					onactivate?.();
					onpart?.('text');
				}}
			></div>
		{:else}
			<div style={textStyle(font)} title={bubble.text}>{bubble.text}</div>
		{/if}
	</foreignObject>
{/if}

{#if editable && (renderMode === 'normal' || renderMode === 'handles')}
	{#if active && bubble.layout !== undefined}
		<BubbleGeometry
			bind:shape={bubble.shape}
			label="Mask"
			active={part === 'mask'}
			{bubbleIndex}
			onactivate={() => {
				onpart?.('mask');
				onactivate?.();
			}}
		/>
		{#if validLayout(bubble.layout)}
			<BubbleGeometry
				bind:shape={
					() => bubble.layout!,
					(shape) => {
						bubble.layout = shape as BblLayout;
					}
				}
				label="Text area"
				active={part === 'text'}
				{bubbleIndex}
				onactivate={() => {
					onactivate?.();
					onpart?.('text');
				}}
			/>
		{/if}
	{:else if bubble.layout === undefined}
		{#if bubble.shape.type === BblShapeType.poly}
			<PolygonEdges bind:shape={bubble.shape} {bubbleIndex} {active} {onactivate} />
		{/if}
		{#each bubble.shape.vs as v, i}
			<DragHandle
				bind:shape={bubble.shape}
				index={i}
				{bubbleIndex}
				style={'cursor:' + cursor}
				{active}
				{onactivate}
			/>
		{/each}
	{/if}
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
		text-align: left;
	}
</style>
