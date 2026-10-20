<script lang="ts">
	import { TreeView } from 'carbon-components-svelte';
	import type { TreeNode } from 'carbon-components-svelte/src/TreeView/TreeView.svelte';
	import type { Comic } from './types/Comic';
	import AlbumIcon from './icons/AlbumIcon.svelte';
	import CollectionIcon from './icons/CollectionIcon.svelte';
	import PageIcon from './icons/PageIcon.svelte';
	import HardDriveIcon from './icons/HardDriveIcon.svelte';
	import { comicNodeId, type ComicFolder } from './types/ComicFolder';
	import DisconnectIcon from './icons/DisconnectIcon.svelte';

	interface Props {
		folders?: ComicFolder[];
		selectedComic?: Comic | null;
		expandedIds?: string[];
		onselect?: (comic: Comic) => void;
		ondisconnect?: (folder: ComicFolder) => void;
	}

	let {
		folders = [],
		selectedComic = $bindable(null),
		expandedIds = $bindable([]),
		onselect,
		ondisconnect
	}: Props = $props();
	let activeId = $derived(selectedComic ? idForComic(selectedComic) : '');

	function idForComic(comic: Comic): string {
		const folder = folders.find((folder) => folder.comics.includes(comic));
		return folder ? comicNodeId(folder, comic) : '';
	}

	function rootLabel(node: HTMLElement, id: string) {
		// Keep the row's accessible name separate from its disconnect button.
		node.closest('[role="treeitem"]')?.setAttribute('aria-labelledby', `folder-label-${id}`);
	}

	function treeKeyboard(node: HTMLDivElement) {
		function selectOnEnter(event: KeyboardEvent) {
			if (
				(event.key !== 'Enter' && event.key !== 'Delete') ||
				event.isComposing ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey
			)
				return;
			const item =
				event.target instanceof HTMLElement
					? event.target.closest<HTMLElement>('[role="treeitem"]')
					: null;
			if (!item) return;
			if (event.key === 'Delete') {
				const id = item.querySelector<HTMLElement>(':scope > div [data-folder-id]')?.dataset
					.folderId;
				const folder = folders.find((folder) => folder.id === id);
				if (folder) {
					event.preventDefault();
					event.stopPropagation();
					ondisconnect?.(folder);
				}
				return;
			}
			if (event.target instanceof Element && event.target.closest('button')) return;
			// Capture Enter before Carbon's handler also toggles parent expansion.
			event.preventDefault();
			event.stopPropagation();
			item.click();
		}
		node.addEventListener('keydown', selectOnEnter, true);
		return {
			destroy() {
				node.removeEventListener('keydown', selectOnEnter, true);
			}
		};
	}

	type TreeChild = TreeNode & { fullName?: string };

	function comicsChildren(
		folder: ComicFolder,
		idx: number[] = [0],
		prefix: string = ''
	): TreeChild[] {
		const cs = folder.comics;
		let result: TreeChild[] = [];
		while (idx[0] < cs.length) {
			let c = cs[idx[0]];
			if (!c.path.startsWith(prefix)) {
				break;
			}
			let tc: TreeChild = {
				id: comicNodeId(folder, c),
				text: c.displayName + (c.kind === 'collection' ? '/' : ''),
				fullName: c.fileName,
				disabled: c.kind === 'archive',
				icon:
					c.kind === 'album' || c.kind === 'archive'
						? AlbumIcon
						: c.kind === 'collection'
							? CollectionIcon
							: PageIcon
			};
			idx[0] = idx[0] + 1;
			if (c.kind === 'album' || c.kind === 'collection') {
				tc.nodes = comicsChildren(folder, idx, c.path);
			}
			result.push(tc);
		}
		return result;
	}

	function forwardSelect(event: CustomEvent<TreeNode>) {
		const folder = folders.find((folder) => String(event.detail.id).startsWith(folder.id + '/'));
		const comics = folder?.comics ?? [];
		const item = comics.find((c) => comicNodeId(folder!, c) === event.detail.id);
		const comic =
			item?.kind === 'album'
				? (comics.find((c) => c.kind === 'page' && c.path === folder?.albumPages[item.path]) ??
					comics.find((c) => c.kind === 'page' && c.path.startsWith(item.path)))
				: item?.kind === 'page'
					? item
					: undefined;
		if (comic && selectedComic !== comic) {
			selectedComic = comic;
			onselect?.(selectedComic);
		}
		activeId = selectedComic ? idForComic(selectedComic) : '';
	}
</script>

<div class="comic-tree" use:treeKeyboard>
	<TreeView
		hideLabel
		labelText="Comics"
		nodes={folders.map((folder) => ({
			id: folder.id,
			text: folder.directory.name,
			icon: HardDriveIcon,
			nodes: comicsChildren(folder)
		}))}
		bind:activeId
		bind:expandedIds
		on:select={forwardSelect}
		let:node
	>
		{@const folder = folders.find((folder) => folder.id === node.id)}
		{#if folder}
			<span class="root-row" data-folder-id={folder.id} use:rootLabel={folder.id}>
				<span class="folder-name" id={`folder-label-${folder.id}`}>{node.text}</span>
				<button
					class="disconnect"
					title="Remove folder"
					aria-label={`Disconnect ${folder.directory.name}`}
					onkeydown={(event) => event.stopPropagation()}
					onclick={(event) => {
						event.stopPropagation();
						ondisconnect?.(folder);
					}}><DisconnectIcon /></button
				>
			</span>
		{:else}
			<span title={(node as TreeChild).fullName}>{node.text}</span>
		{/if}
	</TreeView>
</div>

<style>
	.comic-tree :global(.bx--tree .bx--tree-node) {
		background-color: #fff;
	}
	.comic-tree :global(.bx--tree-node__label:not(:has(.root-row))) {
		align-items: flex-start;
	}
	.comic-tree :global(.bx--tree-node__label__details:not(:has(.root-row))) {
		align-items: flex-start;
	}
	:global(.comic-tree .bx--tree-node__label:not(:has(.root-row)) .bx--tree-node__icon) {
		margin-top: 1px;
	}
	:global(.comic-tree .bx--tree-node__label__details:has(.root-row)),
	:global(.comic-tree .bx--tree-node__label__text:has(.root-row)) {
		display: flex;
		flex: 1;
		min-width: 0;
	}
	.root-row {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
		gap: 0.5rem;
	}
	.folder-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.disconnect {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 2rem;
		height: 2rem;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
	}
	:global(.comic-tree .bx--tree-node__label:hover .root-row .disconnect),
	:global(.comic-tree .bx--tree-node:focus > .bx--tree-node__label .root-row .disconnect),
	.root-row:focus-within .disconnect {
		opacity: 1;
		pointer-events: auto;
	}
	.disconnect:hover {
		background: #e0e0e0;
		color: #da1e28;
	}
	.disconnect:focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: -2px;
	}
</style>
