<script lang="ts">
	import type { Snippet } from 'svelte';

	let { tree, pages }: { tree: Snippet; pages: Snippet } = $props();
	let container: HTMLDivElement;
	let split = $state(50);
	let pointer = $state<number | null>(null);
	let startY = 0;
	let startSplit = 50;

	function resize(value: number) {
		split = Math.max(15, Math.min(85, value));
	}

	function startResize(event: PointerEvent) {
		if (event.button !== 0 || pointer !== null) return;
		event.preventDefault();
		const handle = event.currentTarget as HTMLDivElement;
		handle.focus();
		handle.setPointerCapture(event.pointerId);
		pointer = event.pointerId;
		startY = event.clientY;
		startSplit = split;
	}

	function dragResize(event: PointerEvent) {
		if (pointer !== event.pointerId) return;
		const height = container.clientHeight - 6;
		if (height > 0) resize(startSplit + ((event.clientY - startY) / height) * 100);
	}

	function stopResize(event: PointerEvent) {
		if (pointer !== event.pointerId) return;
		pointer = null;
		const handle = event.currentTarget as HTMLDivElement;
		if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
	}

	function resizeKey(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
		const step = event.shiftKey ? 10 : 2;
		const next =
			event.key === 'ArrowUp'
				? split - step
				: event.key === 'ArrowDown'
					? split + step
					: event.key === 'Home'
						? 15
						: event.key === 'End'
							? 85
							: undefined;
		if (next === undefined) return;
		event.preventDefault();
		resize(next);
	}
</script>

<div
	bind:this={container}
	class="sidebar-panes"
	class:dragging={pointer !== null}
	style:grid-template-rows="minmax(0, {split}fr) 6px minmax(0, {100 - split}fr)"
>
	{@render tree()}
	<!-- A focusable separator supports pointer and keyboard resizing. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="pane-divider"
		role="separator"
		aria-label="Resize sidebar panes"
		aria-orientation="horizontal"
		aria-valuemin={15}
		aria-valuemax={85}
		aria-valuenow={Math.round(split)}
		tabindex="0"
		onpointerdown={startResize}
		onpointermove={dragResize}
		onpointerup={stopResize}
		onpointercancel={stopResize}
		onlostpointercapture={stopResize}
		onkeydown={resizeKey}
		ondblclick={() => resize(50)}
	></div>
	{@render pages()}
</div>

<style>
	.sidebar-panes {
		display: grid;
		height: 100%;
		min-height: 0;
	}
	.pane-divider {
		position: relative;
		cursor: row-resize;
		touch-action: none;
		background: #f4f4f4;
	}
	.pane-divider::after {
		content: '';
		position: absolute;
		inset: 2px 0;
		background: #c6c6c6;
	}
	.pane-divider:hover::after,
	.pane-divider:focus-visible::after,
	.dragging .pane-divider::after {
		background: #0f62fe;
	}
	.pane-divider:focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: -2px;
	}
	.dragging,
	.dragging :global(*) {
		user-select: none;
		cursor: row-resize;
	}
</style>
