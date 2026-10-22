<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
	let { regular = false, ...props }: SVGAttributes<SVGSVGElement> & { regular?: boolean } =
		$props();
	const [width, height, , , path] = faLayerGroup.icon;
</script>

<svg
	{...props}
	width="16"
	height="16"
	viewBox={regular ? '0 0 24 24' : `0 0 ${width} ${height}`}
	fill="currentColor"
	style:fill={regular ? 'none' : undefined}
	stroke={regular ? 'currentColor' : undefined}
	stroke-width={regular ? 1.5 : undefined}
	stroke-linejoin={regular ? 'round' : undefined}
	aria-hidden="true"
	focusable="false"
	data-comic-icon="collection"
	data-icon-style={regular ? 'regular' : 'solid'}
>
	{#if regular}
		<path d="M12 3 22 8 12 13 2 8ZM2 12l10 5 10-5M2 16l10 5 10-5" />
	{:else}{#each Array.isArray(path) ? path : [path] as d}
			<path {d} />
		{/each}{/if}
</svg>
