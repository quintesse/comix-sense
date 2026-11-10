<script>
	import ComicBubble from '../../src/lib/ComicBubble.svelte';
	let { image, imageSize, bubbles, font = {} } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={imageSize.width}
	height={imageSize.height}
	viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
>
	<image href={image} width={imageSize.width} height={imageSize.height} />
	{#each bubbles as bubble, bubbleIndex}
		<ComicBubble {bubble} {bubbleIndex} font={{ ...font, ...bubble.font }} />
	{/each}
</svg>

<style>
	:global(body) {
		margin: 0;
		font-family: sans-serif;
	}
</style>
