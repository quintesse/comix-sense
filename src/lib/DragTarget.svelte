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
