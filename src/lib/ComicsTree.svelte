<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { TreeView } from 'carbon-components-svelte';
	import type { TreeNode, TreeNodeId } from 'carbon-components-svelte/types/TreeView/TreeView.svelte';
	import type { Comic } from './types/Comic';
	import { baseNameExt } from './types/funcs';

	const dispatch = createEventDispatcher();

	export let comics: Comic[] = [];
	export let selectedComic: Comic|null = null;
	$: selectedComic, activeId = selectedComic ? selectedComic.path : "";

	let activeId: TreeNodeId = "";
	
	type TreeChild = TreeNode & { children?: TreeChild[] };

	function comicsChildren(cs: Comic[], idx: number[] = [0], prefix: string = ""): TreeChild[] {
		let result: TreeChild[] = [];
		while (idx[0] < cs.length) {
			let c = cs[idx[0]];
			if (!c.path.startsWith(prefix)) {
				break;
			}
			let nm = c.path.substring(prefix.length);
			if (!c.path.endsWith("/")) {
				[nm, ] = baseNameExt(nm);
			}
			let tc: TreeChild = {
				id: c.path,
				text: nm
			};
			idx[0] = idx[0] + 1;
			if (c.path.endsWith("/")) {
				tc.children = comicsChildren(cs, idx, c.path);
			}
			result.push(tc);
		}
		return result;
	}

	function forwardSelect(event) {
		if (!event.detail.id.endsWith("/")) {
			let comic = comics.filter(c => c.path === event.detail.id);
			if (comic.length == 1) {
				selectedComic = comic[0];
				console.log("COMIC:", selectedComic);
				dispatch('select', comic);
			} else {
				selectedComic = null;
			}
		}
	}
</script>

<TreeView
	hideLabel
	children={comicsChildren(comics)}
	bind:activeId
	on:select={forwardSelect}
/>
