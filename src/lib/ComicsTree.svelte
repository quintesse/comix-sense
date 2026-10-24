<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { TreeView } from 'carbon-components-svelte';
	import type { TreeNode } from 'carbon-components-svelte/src/TreeView/TreeView.svelte';
	import type { Comic } from './types/Comic';
	import AlbumIcon from './icons/AlbumIcon.svelte';
	import UnsavedAlbumIcon from './icons/UnsavedAlbumIcon.svelte';
	import CollectionIcon from './icons/CollectionIcon.svelte';
	import UnsavedCollectionIcon from './icons/UnsavedCollectionIcon.svelte';
	import PageIcon from './icons/PageIcon.svelte';
	import ToolbarIcon from './icons/ToolbarIcon.svelte';
	import { flag } from './languageFlags';
	import HardDriveIcon from './icons/HardDriveIcon.svelte';
	import UnsavedHardDriveIcon from './icons/UnsavedHardDriveIcon.svelte';
	import { comicNodeId, type ComicFolder } from './types/ComicFolder';
	import DisconnectIcon from './icons/DisconnectIcon.svelte';

	interface Props {
		folders?: ComicFolder[];
		selectedLanguage?: string;
		editingMode?: boolean;
		selectedComic?: Comic | null;
		expandedIds?: string[];
		onselect?: (comic: Comic) => void;
		onarchive?: (comic: Comic, select?: boolean) => void;
		ondisconnect?: (folder: ComicFolder) => void;
	}

	let {
		folders = [],
		selectedLanguage = 'org',
		editingMode = false,
		selectedComic = $bindable(null),
		expandedIds = $bindable([]),
		onselect,
		onarchive,
		ondisconnect
	}: Props = $props();
	let activeId = $derived(selectedComic ? idForComic(selectedComic) : '');
	let tree: HTMLDivElement;
	let dirtyPages = $state.raw<Record<string, ReadonlySet<string>>>({});

	$effect(() => {
		untrack(() => (dirtyPages = {}));
		const subscriptions = folders.map((folder) =>
			folder.store.workspace.pendingNodes.subscribe((pages) =>
				untrack(() => (dirtyPages = { ...dirtyPages, [folder.id]: pages }))
			)
		);
		return () => subscriptions.forEach((unsubscribe) => unsubscribe());
	});

	export async function locate() {
		if (!selectedComic) return;
		const folder = folders.find((folder) => folder.comics.includes(selectedComic!));
		if (!folder) return;
		const id = comicNodeId(folder, selectedComic);
		function ancestors(nodes: TreeNode[], parents: string[]): string[] | undefined {
			for (const node of nodes) {
				if (node.id === id) return parents;
				const found = node.nodes && ancestors(node.nodes, [...parents, String(node.id)]);
				if (found) return found;
			}
		}
		const parents = ancestors(comicsChildren(folder), [folder.id]);
		if (!parents) return;
		expandedIds = [...new Set([...expandedIds, ...parents])];
		activeId = id;
		await tick();
		const row = Array.from(tree.querySelectorAll<HTMLElement>('[data-page-id]'))
			.find((node) => node.dataset.pageId === id)
			?.closest<HTMLElement>('[role="treeitem"]');
		row?.focus({ preventScroll: true });
		row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

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

	type TreeChild = TreeNode & { fullName?: string; page?: Comic; unsaved?: boolean };

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
			const dirty = dirtyPages[folder.id] ?? new Set<string>();
			const unsaved =
				c.kind === 'page'
					? dirty.has(c.path)
					: dirty.has(c.path) ||
						[...dirty].some((path) =>
							path.startsWith(c.kind === 'archive' ? c.path + '/' : c.path)
						);
			let tc: TreeChild = {
				id: comicNodeId(folder, c),
				text:
					c.displayName +
					(c.archiveState ? ` (${c.archiveState})` : '') +
					(c.kind === 'collection' ? '/' : ''),
				fullName: c.entryPath ?? c.fileName,
				page: c.kind === 'page' ? c : undefined,
				unsaved,

				icon:
					c.kind === 'album' || c.kind === 'archive'
						? unsaved
							? UnsavedAlbumIcon
							: AlbumIcon
						: c.kind === 'collection'
							? unsaved
								? UnsavedCollectionIcon
								: CollectionIcon
							: undefined
			};
			idx[0] = idx[0] + 1;
			if (c.kind === 'album' || c.kind === 'collection' || c.kind === 'archive') {
				tc.nodes = comicsChildren(folder, idx, c.kind === 'archive' ? c.path + '/' : c.path);
			}
			result.push(tc);
		}
		return result;
	}

	function forwardSelect(event: CustomEvent<TreeNode>) {
		const folder = folders.find((folder) => String(event.detail.id).startsWith(folder.id + '/'));
		const comics = folder?.comics ?? [];
		const item = comics.find((c) => comicNodeId(folder!, c) === event.detail.id);
		if (item?.kind === 'archive') {
			onarchive?.(item, true);
			return;
		}
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

<div class="comic-tree" bind:this={tree} use:treeKeyboard>
	<TreeView
		hideLabel
		size="compact"
		labelText="Comics"
		nodes={folders.map((folder) => ({
			id: folder.id,
			text: folder.directory.name + '/',
			icon: dirtyPages[folder.id]?.size ? UnsavedHardDriveIcon : HardDriveIcon,
			nodes: comicsChildren(folder)
		}))}
		bind:activeId
		bind:expandedIds
		on:select={forwardSelect}
		on:toggle={(event) => {
			if (!event.detail.expanded) return;
			const archive = folders
				.flatMap((f) => f.comics)
				.find((c) => c.kind === 'archive' && idForComic(c) === event.detail.id);
			if (
				archive &&
				archive.archiveState !== 'loading' &&
				!folders.some((f) => f.comics.some((c) => c.album === archive.path))
			)
				onarchive?.(archive, false);
		}}
		let:node
	>
		{@const folder = folders.find((folder) => folder.id === node.id)}
		{#if folder}
			<span class="root-row" data-folder-id={folder.id} use:rootLabel={folder.id}>
				<span
					class="folder-name"
					class:unsaved={!!dirtyPages[folder.id]?.size}
					id={`folder-label-${folder.id}`}>{node.text}</span
				>
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
		{:else if (node as TreeChild).page}
			{@const page = (node as TreeChild).page!}
			{@const translated =
				selectedLanguage !== 'org' && page.hasTranslation(selectedLanguage, editingMode)}
			{@const flagUrl = translated ? flag(selectedLanguage) : undefined}
			{@const unsaved = (node as TreeChild).unsaved}
			<span class="page-row" data-page-id={node.id}>
				<span class="page-icon bx--tree-node__icon" aria-hidden="true">
					{#if unsaved}
						<PageIcon regular />
					{:else if translated && selectedLanguage.toLowerCase() === 'ocr'}
						<ToolbarIcon name="video" />
					{:else if flagUrl}
						<img src={flagUrl} alt="" width="16" height="16" />
					{:else}
						<PageIcon />
					{/if}
				</span>
				<span class:unsaved title={(node as TreeChild).fullName}>{node.text}</span>
			</span>
		{:else}
			<span class:unsaved={(node as TreeChild).unsaved} title={(node as TreeChild).fullName}
				>{node.text}</span
			>
		{/if}
	</TreeView>
</div>

<style>
	.unsaved {
		font-weight: 700;
	}
	.page-row {
		display: inline-flex;
		align-items: center;
	}
	.page-icon {
		display: inline-flex;
		flex: 0 0 16px;
		width: 16px;
		height: 16px;
	}
	.page-icon :global(svg),
	.page-icon img {
		width: 16px;
		height: 16px;
		object-fit: contain;
	}
	.comic-tree :global(.bx--tree .bx--tree-node) {
		background-color: #fff;
	}
	.comic-tree :global(.bx--tree-node__label:not(:has(.root-row))) {
		align-items: center;
	}
	.comic-tree :global(.bx--tree-node__label__details:not(:has(.root-row))) {
		align-items: center;
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
		height: 1.5rem;
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
