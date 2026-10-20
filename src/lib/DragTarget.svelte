<!-- @migration-task Error while migrating Svelte code: This migration would change the name of a slot making the component unusable -->
<script lang="ts">
	let hovering: boolean = false;

	function enter() {
		hovering = true;
		console.log("enter");
	}

	function leave() {
		hovering = false;
		console.log("leave");
	}
</script>

<div on:dragenter={enter} on:dragleave={leave}>
	<slot {hovering}></slot>
	<div style="display: {hovering ? 'block' : 'none'}"><slot name="hovering"></slot></div>
	<div style="display: {hovering ? 'none' : 'block'}"><slot name="idle"></slot></div>
</div>
