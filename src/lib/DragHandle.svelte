<script lang="ts">
	import { BblShapeType, type BblShape } from './types/Comic';
	import { draggable, type DragDetail } from './types/Draggable';
	import { snapPolygonVertex } from './vertexSnap';

	interface Props {
		shape: BblShape;
		index: number;
		bubbleIndex?: number;
		style?: string;
		active?: boolean;
		onactivate?: () => void;
	}

	let {
		shape = $bindable(),
		index,
		bubbleIndex,
		style,
		active = false,
		onactivate
	}: Props = $props();

	function activate() {
		// Dragging prevents the default focus change, so leave the previous text editor explicitly.
		if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable) {
			document.activeElement.blur();
		}
		onactivate?.();
	}
	function updateShape(e: Event) {
		const { x, y, originalEvent } = (e as CustomEvent<DragDetail>).detail;
		let point = { x, y };
		const node = e.currentTarget as SVGGraphicsElement;
		const matrix = node.ownerSVGElement?.getScreenCTM();
		if (shape.type === BblShapeType.poly && !originalEvent.altKey && matrix) {
			// Keep the snap distance at eight screen pixels regardless of page zoom.
			point = snapPolygonVertex(shape.vs, index, point, {
				x: 8 / Math.hypot(matrix.a, matrix.b),
				y: 8 / Math.hypot(matrix.c, matrix.d)
			});
		}
		pos.x = point.x;
		pos.y = point.y;
	}

	let pos = $derived(shape.vs[index]);
</script>

<circle
	role="presentation"
	data-bubble-index={bubbleIndex}
	data-point-index={index}
	cx={pos.x}
	cy={pos.y}
	r="6"
	{style}
	use:draggable
	class:active
	ondragstart={activate}
	oncontextmenu={activate}
	ondrag={updateShape}
/>

<style>
	circle {
		cursor: nw-resize;
		opacity: 0.2;
		user-select: none;
	}

	circle.active {
		fill: #0f62fe;
		opacity: 0.8;
	}
</style>
