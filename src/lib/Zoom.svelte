<script lang="ts">
	import type { Snippet } from 'svelte';

	let { level = '100%', children }: { level?: string | number; children?: Snippet } = $props();
	let viewportSize = $state<DOMRectReadOnly>();
	let width = $derived(viewportSize?.width ?? 0);
	let height = $derived(viewportSize?.height ?? 0);
	let contentWidth = $state(0);
	let contentHeight = $state(0);
	let scale = $derived.by(() => {
		if (!contentWidth || !contentHeight || !width || !height) return 1;
		if (typeof level === 'number') return level;
		if (level === 'fit') return Math.min(width / contentWidth, height / contentHeight);
		if (level === 'width') return width / contentWidth;
		return parseFloat(level) / 100 || 1;
	});
</script>

<div class="viewport" class:fit-width={level === 'width'} bind:contentRect={viewportSize}>
	<div
		class="scaled-content"
		style:max-width={level === 'width' ? '100%' : undefined}
		style:width="{contentWidth * scale}px"
		style:height="{contentHeight * scale}px"
	>
		<div
			class="content"
			bind:clientWidth={contentWidth}
			bind:clientHeight={contentHeight}
			style:transform="scale({scale})"
		>
			{@render children?.()}
		</div>
	</div>
</div>

<style>
	.viewport {
		width: 100%;
		height: 100%;
		overflow: auto;
	}
	.scaled-content {
		/* Transforms shrink the drawing, but not its original overflow bounds. */
		overflow: clip;
	}
	.fit-width {
		overflow-x: hidden;
	}
	.content {
		width: max-content;
		transform-origin: 0 0;
	}
</style>
