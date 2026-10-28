<script lang="ts">
	import type { BblShape, Vertex } from './types/Comic';
	import { draggable, type DragDetail } from './types/Draggable';
	import { dragPolygonEdge } from './polygonDrag';
	import { edgeAlignment } from './vertexSnap';
	let {
		shape = $bindable(),
		bubbleIndex,
		active = false,
		onactivate
	}: {
		shape: BblShape;
		bubbleIndex?: number;
		active?: boolean;
		onactivate?: () => void;
	} = $props();
	let original: Vertex[] = [];
	function start() {
		if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable)
			document.activeElement.blur();
		onactivate?.();
		original = shape.vs.map((v) => ({ ...v }));
	}
	function drag(event: Event, index: number) {
		const { deltaX, deltaY } = (event as CustomEvent<DragDetail>).detail;
		shape.vs = dragPolygonEdge(original, index, { x: deltaX, y: deltaY });
	}
</script>

{#each shape.vs as v, i}
	{@const next = shape.vs[(i + 1) % shape.vs.length]}
	{@const alignment = edgeAlignment(v, next)}
	<line
		role="presentation"
		data-bubble-index={bubbleIndex}
		data-edge-index={i}
		class="hit"
		x1={v.x}
		y1={v.y}
		x2={next.x}
		y2={next.y}
		use:draggable
		ondragstart={start}
		ondrag={(event) => drag(event, i)}><title>Drag polygon edge</title></line
	>
	{#if active && alignment}
		<g data-edge-alignment={alignment} data-aligned-edge-index={i} class="alignment">
			<line x1={v.x} y1={v.y} x2={next.x} y2={next.y} />
			<text x={(v.x + next.x) / 2} y={(v.y + next.y) / 2 - 7}>
				{alignment === 'horizontal' ? 'H' : 'V'}
			</text>
		</g>
	{/if}
{/each}

<style>
	.hit {
		stroke: transparent;
		stroke-width: 8;
		vector-effect: non-scaling-stroke;
		pointer-events: stroke;
		cursor: move;
	}
	.hit:hover {
		stroke: #0f62fe;
		stroke-opacity: 0.4;
	}
	.alignment {
		pointer-events: none;
	}
	.alignment line {
		stroke: #00875a;
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}
	.alignment text {
		fill: #006644;
		stroke: white;
		stroke-width: 3;
		paint-order: stroke;
		font: bold 12px sans-serif;
		text-anchor: middle;
	}
</style>
