<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import HardDriveIcon from './HardDriveIcon.svelte';
	let props: SVGAttributes<SVGSVGElement> = $props();
</script>

<HardDriveIcon {...props} regular />
