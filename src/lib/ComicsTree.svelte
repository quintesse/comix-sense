<script lang="ts">
	import { TreeView } from 'carbon-components-svelte';
	import type { TreeNode } from 'carbon-components-svelte/src/TreeView/TreeView.svelte';
	import type { Comic } from './types/Comic';
	import { baseNameExt } from './types/funcs';
	import AlbumIcon from './icons/AlbumIcon.svelte';
	import CollectionIcon from './icons/CollectionIcon.svelte';
	import PageIcon from './icons/PageIcon.svelte';

	interface Props {
		comics?: Comic[];
		selectedComic?: Comic | null;
		expandedIds?: string[];
		albumPages?: Record<string, string>;
		onselect?: (comic: Comic) => void;
	}

	let {
		comics = [],
		selectedComic = $bindable(null),
		expandedIds = $bindable([]),
		albumPages = {},
		onselect
	}: Props = $props();
	let activeId = $derived(selectedComic ? selectedComic.path : '');

	function treeKeyboard(node: HTMLDivElement) {
		function selectOnEnter(event: KeyboardEvent) {
			if (
				event.key !== 'Enter' ||
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

	type TreeChild = TreeNode;

	function comicsChildren(cs: Comic[], idx: number[] = [0], prefix: string = ''): TreeChild[] {
		let result: TreeChild[] = [];
		while (idx[0] < cs.length) {
			let c = cs[idx[0]];
			if (!c.path.startsWith(prefix)) {
				break;
			}
			let nm = c.path.substring(prefix.length);
			if (c.kind === 'page') {
				[nm] = baseNameExt(nm);
			} else if (c.kind === 'album') {
				nm = nm.replace(/\/$/, '');
			}
			let tc: TreeChild = {
				id: c.path,
				text: nm,
				icon: c.kind === 'album' ? AlbumIcon : c.kind === 'collection' ? CollectionIcon : PageIcon
			};
			idx[0] = idx[0] + 1;
			if (c.kind !== 'page') {
				tc.nodes = comicsChildren(cs, idx, c.path);
			}
			result.push(tc);
		}
		return result;
	}

	function forwardSelect(event: CustomEvent<TreeNode>) {
		const item = comics.find((c) => c.path === event.detail.id);
		const comic =
			item?.kind === 'album'
				? (comics.find((c) => c.kind === 'page' && c.path === albumPages[item.path]) ??
					comics.find((c) => c.kind === 'page' && c.path.startsWith(item.path)))
				: item?.kind === 'page'
					? item
					: undefined;
		if (comic && selectedComic !== comic) {
			selectedComic = comic;
			onselect?.(selectedComic);
		}
		activeId = selectedComic?.path ?? '';
	}
</script>

<div use:treeKeyboard>
	<TreeView
		hideLabel
		labelText="Comics"
		nodes={comicsChildren(comics)}
		bind:activeId
		bind:expandedIds
		on:select={forwardSelect}
	/>
</div>
