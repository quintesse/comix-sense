<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import { faBookOpen } from '@fortawesome/free-solid-svg-icons';
	let { regular = false, ...props }: SVGAttributes<SVGSVGElement> & { regular?: boolean } =
		$props();
	const [width, height, , , path] = faBookOpen.icon;
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
	data-comic-icon="album"
	data-icon-style={regular ? 'regular' : 'solid'}
>
	{#if regular}
		<path d="M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v16" />
	{:else}{#each Array.isArray(path) ? path : [path] as d}
			<path {d} />
		{/each}{/if}
</svg>
