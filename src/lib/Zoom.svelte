<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		level = '100%',
		contentSize,
		centered = false,
		children
	}: {
		level?: string | number;
		contentSize?: { width: number; height: number };
		centered?: boolean;
		children?: Snippet;
	} = $props();
	let viewportSize = $state<DOMRectReadOnly>();
	let width = $derived(viewportSize?.width ?? 0);
	let height = $derived(viewportSize?.height ?? 0);
	let measuredWidth = $state(0);
	let measuredHeight = $state(0);
	let contentWidth = $derived(contentSize?.width ?? measuredWidth);
	let contentHeight = $derived(contentSize?.height ?? measuredHeight);
	let scale = $derived.by(() => {
		if (!contentWidth || !contentHeight || !width || !height) return 1;
		if (typeof level === 'number') return level;
		if (level === 'fit') return Math.min(width / contentWidth, height / contentHeight);
		if (level === 'width') return width / contentWidth;
		return parseFloat(level) / 100 || 1;
	});
</script>

<div
	class="viewport"
	class:centered
	class:fit-width={level === 'width'}
	bind:contentRect={viewportSize}
>
	<div
		class="scaled-content"
		style:max-width={level === 'width' ? '100%' : undefined}
		style:width="{contentWidth * scale}px"
		style:height="{contentHeight * scale}px"
	>
		<div
			class="content"
			bind:clientWidth={measuredWidth}
			bind:clientHeight={measuredHeight}
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
	.centered {
		display: flex;
	}
	.centered .scaled-content {
		/* Auto margins center spare space, but become zero on overflowing axes. */
		margin: auto;
		flex: none;
	}
	.scaled-content {
		/* Transforms shrink the drawing, but not its original overflow bounds. */
		overflow: clip;
	}
	.fit-width {
		overflow-x: hidden;
	}
	.content {
		display: flex;
		align-items: flex-start;
		width: max-content;
		transform-origin: 0 0;
	}
</style>
