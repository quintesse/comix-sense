<script lang="ts">
	let {
		name
	}: {
		name: 'eye' | 'file-pen' | 'comments' | 'file' | 'book-open' | 'square' | 'star' | 'video';
	} = $props();
</script>

<svg
	width="20"
	height="20"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
	data-toolbar-icon={name}
>
	{#if name === 'eye'}
		<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
	{:else if name === 'file' || name === 'file-pen'}
		<path d="M13 2H5a1 1 0 0 0-1 1v18a1 1 0 0 0 1 1h10M13 2l6 6M13 2v6h6v3" />
		{#if name === 'file'}<path d="M19 11v10a1 1 0 0 1-1 1h-3" />
		{:else}<path d="m13 18 7-7 2 2-7 7-3 1 1-3Zm5-5 2 2" />{/if}
	{:else if name === 'comments'}
		<path d="M15 14H8l-5 3v-5a6 6 0 0 1-1-3c0-3.3 3.6-6 8-6s8 2.7 8 6c0 2-1.2 3.7-3 5Z" /><path
			d="M9 17c1.4 1.3 3.6 2 6 2h2l4 2v-4a5 5 0 0 0 1-3c0-1.8-1.1-3.5-3-4.5"
		/>
	{:else if name === 'book-open'}
		<path d="M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v16" />
	{:else if name === 'video'}
		<rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 9 6-4v14l-6-4Z" />
	{:else if name === 'square'}
		<rect x="3" y="3" width="18" height="18" rx="1" />
	{:else}
		<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1L12 2Z" />
	{/if}
</svg>
