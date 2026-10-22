<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import { faFile } from '@fortawesome/free-solid-svg-icons';
	let { regular = false, ...props }: SVGAttributes<SVGSVGElement> & { regular?: boolean } =
		$props();
	const [width, height, , , path] = faFile.icon;
</script>

<svg
	{...props}
	width="16"
	height="16"
	viewBox={regular ? '0 0 24 24' : `0 0 ${width} ${height}`}
	fill={regular ? 'none' : 'currentColor'}
	style:fill={regular ? 'none' : undefined}
	stroke={regular ? 'currentColor' : undefined}
	stroke-width={regular ? 1.5 : undefined}
	stroke-linejoin={regular ? 'round' : undefined}
	aria-hidden="true"
	focusable="false"
	data-comic-icon="page"
	data-icon-style={regular ? 'regular' : 'solid'}
>
	{#if regular}
		<path d="M14 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8ZM14 2v6h6" />
	{:else}{#each Array.isArray(path) ? path : [path] as d}
			<path {d} />
		{/each}{/if}
</svg>
