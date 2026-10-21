<script lang="ts">
	import { tick } from 'svelte';
	import { textStyle } from './bbl/FontResources';
	import type { Font } from './bbl/metadata';
	import DragHandle from './DragHandle.svelte';
	import { bounds, points, type Bubble, BblShapeType } from './types/Comic';
	import type { StrStrMap } from './types/funcs';

	interface Props {
		bubble: Bubble;
		editable?: boolean;
		renderMode?: string;
		bubbleIndex?: number;
		font?: Font;
		active?: boolean;
		onactivate?: () => void;
	}

	let {
		bubble = $bindable(),
		editable = false,
		renderMode = 'normal',
		bubbleIndex,
		font = {},
		active = false,
		onactivate
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
		await tick();
		// SVG reordering can blur the editor; retain its focus and caret after raising it.
		if (!editor.isConnected || !active || document.activeElement === editor) return;
		editor.focus({ preventScroll: true });
		range.setStart(startContainer, startOffset);
		range.setEnd(endContainer, endOffset);
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	function styleString(style: StrStrMap | undefined): string {
		return Object.entries(style || {})
			.map((e) => e[0] + ':' + e[1] + ';')
			.join('');
	}

	let cursor = $derived(bubble.shape.type === BblShapeType.box ? 'nw-resize' : 'move');
	let shapeStyle = $derived(styleString(bubble.style));
	let bb = $derived(bounds(bubble.shape.vs));
</script>

{#if renderMode === 'normal' || renderMode === 'content' || renderMode === 'shapes' || renderMode === 'clippath'}
	{#if bubble.shape.type === BblShapeType.box}
		<rect
			data-bubble-index={bubbleIndex}
			x={bb.x1}
			y={bb.y1}
			width={bb.w}
			height={bb.h}
			class="bubble"
			style={shapeStyle}
		>
			{#if bubble.text && renderMode !== 'clippath'}
				<title>{bubble.text}</title>
			{/if}
		</rect>
	{:else if bubble.shape.type === BblShapeType.poly}
		<polygon
			data-bubble-index={bubbleIndex}
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

{#if renderMode === 'normal' || renderMode === 'content' || renderMode === 'text'}
	<foreignObject data-bubble-index={bubbleIndex} x={bb.x1} y={bb.y1} width={bb.w} height={bb.h}>
		{#if editable}
			<div
				title={bubble.text}
				style={textStyle(font)}
				role="textbox"
				aria-label="Bubble text"
				contenteditable="true"
				bind:textContent={bubble.text}
				onfocus={activateEditor}
			></div>
		{:else}
			<div style={textStyle(font)} title={bubble.text}>{bubble.text}</div>
		{/if}
	</foreignObject>
{/if}

{#if editable && (renderMode === 'normal' || renderMode === 'handles')}
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
