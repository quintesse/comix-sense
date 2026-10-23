<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, ondismiss, children }: { label: string; ondismiss: () => void; children: Snippet } =
		$props();
</script>

<div class="notification">
	<div>{@render children()}</div>
	<button type="button" aria-label={label} title={label} onclick={ondismiss}>×</button>
</div>

<style>
	.notification {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: white;
		color: #161616;
		border: 1px solid #c6c6c6;
		border-radius: 0.125rem;
		box-shadow: 0 2px 6px #0003;
	}
	.notification > div {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	button {
		flex-shrink: 0;
		margin-left: auto;
		border: 0;
		background: transparent;
		color: #525252;
		cursor: pointer;
		font-size: 1.25rem;
		padding: 0.25rem 0.5rem;
	}
	button:hover {
		background: #e8e8e8;
	}
	button:focus-visible {
		outline: 2px solid #0f62fe;
	}
</style>
