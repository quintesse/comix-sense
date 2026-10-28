<script lang="ts">
	import { bounds, points, vertex, type BblShape, type Vertex } from './types/Comic';
	import { draggable, type DragDetail } from './types/Draggable';
	import DragHandle from './DragHandle.svelte';
	import PolygonEdges from './PolygonEdges.svelte';
	let {
		shape = $bindable(),
		label,
		active,
		bubbleIndex,
		onactivate
	}: {
		shape: BblShape;
		label: 'Text area' | 'Mask';
		active: boolean;
		bubbleIndex?: number;
		onactivate: () => void;
	} = $props();
	let bb = $derived(bounds(shape.vs));
	let corners = $derived([
		vertex(bb.x1, bb.y1),
		vertex(bb.x2, bb.y1),
		vertex(bb.x2, bb.y2),
		vertex(bb.x1, bb.y2)
	]);
	let original: Vertex[] = [];
	function activate() {
		if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable)
			document.activeElement.blur();
		onactivate();
		original = shape.vs.map((v) => ({ ...v }));
	}
	function move(event: Event) {
		const { deltaX, deltaY } = (event as CustomEvent<DragDetail>).detail;
		shape.vs = original.map((v) => vertex(v.x + deltaX, v.y + deltaY));
	}
	function resize(event: Event, index: number) {
		const { x, y } = (event as CustomEvent<DragDetail>).detail;
		const b = bounds(original);
		const opposite = [
			vertex(b.x2, b.y2),
			vertex(b.x1, b.y2),
			vertex(b.x1, b.y1),
			vertex(b.x2, b.y1)
		][index];
		if (Math.abs(x - opposite.x) > 0 && Math.abs(y - opposite.y) > 0)
			shape.vs = [opposite, vertex(x, y)];
	}
</script>

<g
	data-bubble-index={bubbleIndex}
	data-geometry={label}
	class:text-area={label === 'Text area'}
	class:active
>
	<polygon points={points(shape.type === 'box' ? corners : shape.vs)} class="outline" />
	<text x={bb.x1} y={bb.y1 - (label === 'Text area' ? 26 : 9)} class="label">{label}</text>
	{#if active}
		{#if shape.type === 'box'}
			{#each corners as v, i}
				<circle
					role="presentation"
					data-resize={i}
					cx={v.x}
					cy={v.y}
					r="6"
					use:draggable
					ondragstart={activate}
					ondrag={(e) => resize(e, i)}
				/>
			{/each}
		{:else}
			<PolygonEdges bind:shape {bubbleIndex} active {onactivate} />
			{#each shape.vs as v, i}
				<DragHandle bind:shape index={i} {bubbleIndex} active {onactivate} />
			{/each}
		{/if}
		<g
			role="presentation"
			data-move-grip={label}
			use:draggable
			ondragstart={activate}
			ondrag={move}
			class="grip"
		>
			<rect x={bb.x1 + 12} y={bb.y1 - 6} width="24" height="16" rx="3" />
			<path d="M {bb.x1 + 16} {bb.y1 + 2} h 16 m -8 -5 v 10" />
			<title>Move {label}</title>
		</g>
	{/if}
</g>

<style>
	.outline {
		fill: none;
		stroke: #222;
		stroke-width: 2;
		pointer-events: none;
	}
	.text-area .outline {
		stroke-dasharray: 8 4;
	}
	.label {
		font: bold 13px sans-serif;
		fill: #111;
		stroke: white;
		stroke-width: 3;
		paint-order: stroke;
		pointer-events: none;
	}
	circle {
		fill: #0f62fe;
		stroke: white;
		stroke-width: 1;
		cursor: nwse-resize;
	}
	.grip {
		cursor: move;
	}
	.grip rect {
		fill: white;
		stroke: #222;
		stroke-width: 2;
	}
	.grip path {
		stroke: #222;
		pointer-events: none;
	}
</style>
