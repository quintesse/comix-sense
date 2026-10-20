<script lang="ts">
	import type { Comic } from './types/Comic';
	import { baseNameExt } from './types/funcs';

	let {
		pages,
		selectedComic,
		onselect
	}: {
		pages: Comic[];
		selectedComic: Comic | null;
		onselect: (comic: Comic) => void;
	} = $props();
	let list: HTMLUListElement;

	function pageKeyboard(event: KeyboardEvent) {
		if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
		const buttons = Array.from(list.querySelectorAll('button'));
		const index = buttons.indexOf(event.target as HTMLButtonElement);
		if (index < 0) return;
		const next =
			event.key === 'ArrowDown'
				? Math.min(index + 1, buttons.length - 1)
				: event.key === 'ArrowUp'
					? Math.max(index - 1, 0)
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? buttons.length - 1
							: undefined;
		if (next !== undefined) {
			event.preventDefault();
			buttons[next].focus();
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			onselect(pages[index]);
		}
	}

	function keyboard(node: HTMLUListElement) {
		node.addEventListener('keydown', pageKeyboard);
		return { destroy: () => node.removeEventListener('keydown', pageKeyboard) };
	}

	$effect(() => {
		const path = selectedComic?.path;
		if (!path || !list) return;
		const current = Array.from(list.querySelectorAll('button')).find(
			(button) => button.dataset.page === path
		);
		if (!current) return;
		// Scroll only this pane, without moving focus or the tree above it.
		if (current.offsetTop < list.scrollTop) list.scrollTop = current.offsetTop;
		else if (current.offsetTop + current.offsetHeight > list.scrollTop + list.clientHeight)
			list.scrollTop = current.offsetTop + current.offsetHeight - list.clientHeight;
	});

	function thumbnail(node: HTMLImageElement, comic: Comic) {
		let disposed = false;
		let url: string | undefined;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void comic.getImageUrl().then(
					(loaded) => {
						if (disposed) URL.revokeObjectURL(loaded);
						else {
							url = loaded;
							node.src = loaded;
						}
					},
					() => {
						if (!disposed) node.alt = 'Preview unavailable';
					}
				);
			},
			{ root: list, rootMargin: '200px' }
		);
		observer.observe(node);
		return {
			destroy() {
				disposed = true;
				observer.disconnect();
				if (url) URL.revokeObjectURL(url);
			}
		};
	}
</script>

<section aria-label="Album pages">
	<h2>Pages</h2>
	<ul bind:this={list} use:keyboard>
		{#each pages as comic (comic)}
			<li>
				<button
					type="button"
					data-page={comic.path}
					aria-current={selectedComic === comic ? 'page' : undefined}
					onclick={() => onselect(comic)}
				>
					<img use:thumbnail={comic} alt="" />
					<span>{baseNameExt(comic.path.split('/').at(-1)!)[0]}</span>
				</button>
			</li>
		{:else}
			<li class="empty">Select an album to see its pages.</li>
		{/each}
	</ul>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	h2 {
		flex: none;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	ul {
		position: relative;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
		list-style: none;
		padding: 0.25rem 0.75rem;
	}
	li {
		margin-bottom: 0.5rem;
	}
	button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		padding: 0.5rem;
		border: 2px solid transparent;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	button:hover {
		background: #e8e8e8;
	}
	button[aria-current='page'] {
		border-color: #0f62fe;
		background: #edf5ff;
	}
	button:focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: -2px;
	}
	img {
		width: 100%;
		height: 12rem;
		object-fit: contain;
		background: #e0e0e0;
	}
	span {
		max-width: 100%;
		overflow-wrap: anywhere;
		font-size: 0.875rem;
	}
	.empty {
		padding: 0.5rem;
		font-size: 0.875rem;
	}
</style>
