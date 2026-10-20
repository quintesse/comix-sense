<script lang="ts">
	import type { BblShape } from './types/Comic';
	import { draggable } from './types/Draggable';

	interface Props {
		shape: BblShape;
		index: number;
		style?: string;
	}

	let { shape = $bindable(), index, style }: Props = $props();

	function updateShape(e: Event) {
		const ce: CustomEvent = e as CustomEvent;
		pos.x = ce.detail.x;
		pos.y = ce.detail.y;
	}

	let pos = $derived(shape.vs[index]);
</script>

<circle
	role="presentation"
	cx={pos.x}
	cy={pos.y}
	r="6"
	{style}
	use:draggable
	ondrag={updateShape}
/>

<style>
	circle {
		cursor: nw-resize;
		opacity: 0.2;
		user-select: none;
	}
</style>
