<script lang="ts">
	import { TreeView } from 'carbon-components-svelte';
	import type { TreeNode } from 'carbon-components-svelte/src/TreeView/TreeView.svelte';
	import type { Comic } from './types/Comic';
	import { baseNameExt } from './types/funcs';

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
			if (!c.path.endsWith('/')) {
				[nm] = baseNameExt(nm);
			}
			let tc: TreeChild = {
				id: c.path,
				text: nm
			};
			idx[0] = idx[0] + 1;
			if (c.path.endsWith('/')) {
				tc.nodes = comicsChildren(cs, idx, c.path);
			}
			result.push(tc);
		}
		return result;
	}

	function forwardSelect(event: CustomEvent<TreeNode>) {
		if (!String(event.detail.id).endsWith('/')) {
			let comic = comics.filter((c) => c.path === event.detail.id);
			if (comic.length == 1 && selectedComic !== comic[0]) {
				selectedComic = comic[0];
				onselect?.(selectedComic);
			}
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
