<script lang="ts">
	import type { BblShape } from './types/Comic';
	import { draggable } from './types/Draggable';

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
		const ce: CustomEvent = e as CustomEvent;
		pos.x = ce.detail.x;
		pos.y = ce.detail.y;
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
