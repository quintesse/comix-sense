<script lang="ts">
	import type { Snippet } from 'svelte';

	let { level = '100%', children }: { level?: string | number; children?: Snippet } = $props();
	let width = $state(0);
	let height = $state(0);
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

<div class="viewport" bind:clientWidth={width} bind:clientHeight={height}>
	<div style:width="{contentWidth * scale}px" style:height="{contentHeight * scale}px">
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
	.content {
		display: inline-block;
		transform-origin: 0 0;
		vertical-align: top;
	}
</style>
