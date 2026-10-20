<script lang="ts">
	import { releaseImageUrl } from './ImageUrls';
	import type { Comic } from './types/Comic';

	let {
		pages,
		selectedComic,
		noSources = false,
		onselect
	}: {
		pages: Comic[];
		selectedComic: Comic | null;
		noSources?: boolean;
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
		let generation = 0;
		let visible = false;
		const observer = new IntersectionObserver(
			(entries) => {
				visible = entries.some((entry) => entry.isIntersecting);
				if (!comic.entryPath) {
					if (!visible) return;
					observer.disconnect();
				}
				if (!visible) {
					generation++;
					if (url) releaseImageUrl(url);
					url = undefined;
					node.removeAttribute('src');
					return;
				}
				if (url) return;
				const request = ++generation;
				void comic.getImageUrl('thumbnail').then(
					(loaded) => {
						if (disposed || !visible || request !== generation) releaseImageUrl(loaded);
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
				if (url) releaseImageUrl(url);
			}
		};
	}
</script>

<section aria-label="Album pages" class:empty-pane={pages.length === 0}>
	<h2>Pages</h2>
	<ul bind:this={list} use:keyboard>
		{#each pages as comic (comic)}
			<li>
				<button
					type="button"
					data-page={comic.path}
					title={comic.entryPath ?? comic.fileName}
					aria-current={selectedComic === comic ? 'page' : undefined}
					onclick={() => onselect(comic)}
				>
					<img use:thumbnail={comic} alt="" />
					<span>{comic.displayName}</span>
				</button>
			</li>
		{:else}
			<li class="empty">
				{noSources ? 'Add a comics source' : 'Select an album to see its pages.'}
			</li>
		{/each}
	</ul>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	section.empty-pane {
		background: #f4f4f4;
		color: #6f6f6f;
	}
	section.empty-pane ul {
		flex: 1;
		display: grid;
		place-items: center;
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
