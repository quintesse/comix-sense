<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import { faBookOpen } from '@fortawesome/free-solid-svg-icons';
	let props: SVGAttributes<SVGSVGElement> = $props();
	const [width, height, , , path] = faBookOpen.icon;
</script>

<svg
	{...props}
	width="16"
	height="16"
	viewBox={`0 0 ${width} ${height}`}
	fill="currentColor"
	aria-hidden="true"
	focusable="false"
	data-comic-icon="album"
>
	{#each Array.isArray(path) ? path : [path] as d}
		<path {d} />
	{/each}
</svg>
