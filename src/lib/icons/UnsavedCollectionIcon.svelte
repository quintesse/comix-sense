<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import CollectionIcon from './CollectionIcon.svelte';
	let props: SVGAttributes<SVGSVGElement> = $props();
</script>

<CollectionIcon {...props} regular />
