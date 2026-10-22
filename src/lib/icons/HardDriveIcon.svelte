<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';
	import { faHardDrive } from '@fortawesome/free-solid-svg-icons';
	let { regular = false, ...props }: SVGAttributes<SVGSVGElement> & { regular?: boolean } =
		$props();
	const [width, height, , , path] = faHardDrive.icon;
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
	data-comic-icon="hard-drive"
	data-icon-style={regular ? 'regular' : 'solid'}
>
	{#if regular}
		<path d="M5 3h14l3 12v6H2v-6ZM2 15h20" /><circle cx="18" cy="18" r="0.5" />
	{:else}{#each Array.isArray(path) ? path : [path] as d}
			<path {d} />
		{/each}{/if}
</svg>
