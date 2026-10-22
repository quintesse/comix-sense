<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import AlbumIcon from './AlbumIcon.svelte';
	let props: SVGAttributes<SVGSVGElement> = $props();
</script>

<AlbumIcon {...props} regular />
