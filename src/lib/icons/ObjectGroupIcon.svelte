<script lang="ts">
	import { faObjectGroup } from '@fortawesome/free-solid-svg-icons';
	const [width, height, , , path] = faObjectGroup.icon;
</script>

<svg
	width="20"
	height="20"
	viewBox={`0 0 ${width} ${height}`}
	fill="currentColor"
	aria-hidden="true"
	focusable="false"
	data-language-icon="object-group"
>
	{#each Array.isArray(path) ? path : [path] as d}<path {d} />{/each}
</svg>
