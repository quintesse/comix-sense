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
		onselect?: (comic: Comic) => void;
	}

	let {
		comics = [],
		selectedComic = $bindable(null),
		expandedIds = $bindable([]),
		onselect
	}: Props = $props();
	let activeId = $derived(selectedComic ? selectedComic.path : '');

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
		const comic = comics.find((c) => c.kind === 'page' && c.path === event.detail.id);
		if (comic && selectedComic !== comic) {
			selectedComic = comic;
			onselect?.(selectedComic);
		}
	}
</script>

<TreeView
	hideLabel
	labelText="Comics"
	nodes={comicsChildren(comics)}
	bind:activeId
	bind:expandedIds
	on:select={forwardSelect}
/>
