<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		children,
		hovering,
		idle
	}: {
		children?: Snippet<[{ hovering: boolean }]>;
		hovering?: Snippet;
		idle?: Snippet;
	} = $props();
	let isHovering = $state(false);

	function enter() {
		isHovering = true;
	}

	function leave() {
		isHovering = false;
	}
</script>

<div role="presentation" ondragenter={enter} ondragleave={leave}>
	{@render children?.({ hovering: isHovering })}
	<div style:display={isHovering ? 'block' : 'none'}>{@render hovering?.()}</div>
	<div style:display={isHovering ? 'none' : 'block'}>{@render idle?.()}</div>
</div>
