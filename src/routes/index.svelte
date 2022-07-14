<script lang="ts">
	import 'carbon-components-svelte/css/white.css';
	import {
		Header, HeaderNav, HeaderNavItem, HeaderNavMenu,
		SideNav,
		SkipToContent, Content,
		//
		FileUploaderDropContainer,
		//
		Button,
		TileGroup,
		RadioTile,
		//
		ContextMenu,
		ContextMenuDivider,
		ContextMenuOption,
ContextMenuRadioGroup,
	} from 'carbon-components-svelte';
  	import { base } from "$app/paths";
	import { writable } from 'svelte/store';
	import { collectionStore } from '$lib/stores/CollectionStore';
	import { BblShapeType, boundsv, samevs, Shape, vertex, type BblShape, type Bubble, type Comic, type Vertex } from '$lib/types/Comic';
	import { DirectoryComicStore, type ComicStore } from '$lib/types/ComicStore';
	import ComicsTree from '$lib/ComicsTree.svelte';
	import ComicPage from '$lib/ComicPage.svelte';
	import ComicBubble from '$lib/ComicBubble.svelte';
	import Zoom from '$lib/Zoom.svelte';
	import Resource from '$lib/Resource.svelte';
	import { dedup } from '$lib/types/funcs';

	let isSideNavOpen = false;

	let selectedZoom: string = "width";
	let selectedLanguage: string = "org";
	let selectedShape: BblShapeType = BblShapeType.box;
	let selectedEdit: string = "no";
	$: editable = selectedEdit === "yes";

	let store: ComicStore|null = null;
	let comics = writable<Comic[]>([]);
	let selectedComic = writable<Comic|null>(null);
	let collection = collectionStore(comics, selectedComic);
	$: languages = dedup($collection.flatMap(c => c.languages));
	let bubbles = writable<Bubble[]>([]);

	selectedComic.subscribe(c => {
		if (c) {
			c.getBubbles(selectedLanguage)
				.then(bs => bubbles.set(bs))
				.catch(err => {
					console.error(err);
					bubbles.set([]);
				});
		} else {
			bubbles.set([]);
		}
	});

	$: selectedLanguage, update();
	function update() {
		selectedComic.set($selectedComic);
	}

	async function selectDirectory() {
		let comicsFolder = await window.showDirectoryPicker();
		store = new DirectoryComicStore(comicsFolder);
		comics.set(await store.list());
	}

    function handleNewBubble(evt: CustomEvent<BblShape>) {
		$bubbles.push({ text: "", shape: evt.detail } as Bubble);
		bubbles.set($bubbles); // force update
	}

	let menuTargetBubble: Bubble|undefined;

	function setupMenu(evt: CustomEvent<Element>) {
		const target = evt.detail;
		const isBubble = (evt.detail.tagName.toLowerCase() === "div") && editable;
		if (isBubble) {
			menuTargetBubble = findBubble(target);
		} else {
			menuTargetBubble = undefined;
		}
	}

	function findBubble(elem: Element): Bubble|undefined {
		const fo: SVGForeignObjectElement|null = elem.closest("foreignobject");
		if (fo) {
			const elem = fo.previousElementSibling;
			if (elem?.tagName.toLowerCase() === "rect" || elem?.tagName.toLowerCase() === "polygon") {
				let vs: Vertex[];
				if (elem?.tagName.toLowerCase() === "rect") {
					const rect = elem as SVGRectElement;
					const v1 = vertex(rect.x.baseVal.value, rect.y.baseVal.value);
					const v2 = vertex(v1.x + rect.width.baseVal.value, v1.y + rect.height.baseVal.value);
					vs = [v1, v2];
				} else {
					const poly = elem as SVGPolygonElement;
					vs = [];
					for (let i = 0; i < poly.points.length; i++) {
						const p = poly.points[i];
						vs.push(vertex(p.x, p.y));
					}
				}
				const bbl = $bubbles.find(b => samevs(b.shape.vs, vs));
				return bbl;
			}
		}
		return undefined;
	}

	function handleBubbleDelete() {
		if (menuTargetBubble) {
			const bbls = $bubbles;
			const idx = bbls.indexOf(menuTargetBubble);
			if (idx >= 0) {
				bbls.splice(idx, 1);
				bubbles.set(bbls); // force update
			}
		}
	}

	function handleConvertToBox() {
		if (menuTargetBubble && menuTargetBubble.shape.type === BblShapeType.poly) {
			const shp = menuTargetBubble.shape;
			shp.type = BblShapeType.box;
			shp.vs = boundsv(shp.vs);
			bubbles.set($bubbles); // force update
		}
	}

	function handleConvertToPoly() {
		if (menuTargetBubble && menuTargetBubble.shape.type === BblShapeType.box) {
			const shp = menuTargetBubble.shape;
			shp.type = BblShapeType.poly;
			const v1 = vertex(shp.vs[0].x, shp.vs[0].y);
			const v2 = vertex(shp.vs[1].x, shp.vs[0].y);
			const v3 = vertex(shp.vs[1].x, shp.vs[1].y);
			const v4 = vertex(shp.vs[0].x, shp.vs[1].y);
			shp.vs = [v1, v2, v3, v4];
			bubbles.set($bubbles); // force update
		}
	}
	
	const zoomLevels = [
		{ id: "fit", label: "Fit" },
		{ id: "width", label: "Width" },
		{ id: "200%", label: "200%" },
		{ id: "175%", label: "175%" },
		{ id: "150%", label: "150%" },
		{ id: "125%", label: "125%" },
		{ id: "100%", label: "100%" },
		{ id: "75%", label: "75%" },
		{ id: "50%", label: "50%" },
		{ id: "25%", label: "25%" }
	];
</script>

<Header platformName="Comix Sense" bind:isSideNavOpen>
	<svelte:fragment slot="skip-to-content">
		<SkipToContent />
	</svelte:fragment>
	<HeaderNav>
		<HeaderNavItem href="{base}/" text="Link 1" />
		<HeaderNavItem href="{base}/" text="Link 2" />
		<HeaderNavMenu text={selectedZoom.toUpperCase()}>
			<TileGroup bind:selected={selectedZoom}>
				{#each zoomLevels as {id, label}}
					<RadioTile value={id}>{label}</RadioTile>
				{/each}
			</TileGroup>
		</HeaderNavMenu>
		<HeaderNavMenu text={selectedLanguage ? selectedLanguage.toUpperCase() : "ORG"}>
			<TileGroup bind:selected={selectedLanguage}>
				<RadioTile value="org">ORG</RadioTile>
				{#each languages as lang}
					<RadioTile value={lang}>{lang.toUpperCase()}</RadioTile>
				{/each}
			</TileGroup>
		</HeaderNavMenu>
		<HeaderNavMenu text={"EDIT: " + selectedEdit.toUpperCase()}>
			<TileGroup bind:selected={selectedEdit}>
				<RadioTile value="yes">Yes</RadioTile>
				<RadioTile value="no">No</RadioTile>
			</TileGroup>
		</HeaderNavMenu>
		{#if editable}
		<HeaderNavMenu text={selectedShape.toUpperCase()}>
			<TileGroup bind:selected={selectedShape}>
				<RadioTile value="box">Box</RadioTile>
				<RadioTile value="poly">Poly</RadioTile>
			</TileGroup>
		</HeaderNavMenu>
		{/if}
	</HeaderNav>
</Header>

<SideNav bind:isOpen={isSideNavOpen}>
	{#if store}
		<div class="tree">
			<ComicsTree
				comics={$comics}
				on:select={e => selectedComic.set(e.detail)}
			/>
		</div>
		<FileUploaderDropContainer
			multiple
			labelText="Drag and drop files here or click to upload"
			validateFiles={(files) => files}
			on:change={(e) => {
				console.log('files', e.detail);
			}}
		/>
	{:else}
		<div>
			<Button on:click={selectDirectory}>Select directory...</Button>
		</div>
	{/if}
</SideNav>

<Content style="padding: 0" class="fullsize">
	{#if $selectedComic}
		{#await $selectedComic.getImageUrl() then imgurl}
		<Zoom level={selectedZoom}>
			<ComicPage img={imgurl} {editable} {selectedShape} let:renderMode on:shape={handleNewBubble}>
				{#each $bubbles as bubble (bubble)}
    	            <ComicBubble {bubble} {renderMode} {editable} />
	            {/each}
			</ComicPage>
		</Zoom>
		<!-- this tracks the imgurl and revokes it when it's no longer needed -->
		<Resource url={imgurl} />
		{/await}
	{:else}
		Select a comic from the left
	{/if}

	<ContextMenu on:open={setupMenu}>
		{#if menuTargetBubble}
			{#if menuTargetBubble.shape.type === BblShapeType.poly}
			<ContextMenuOption labelText="Convert to Box" on:click={handleConvertToBox} />
			{:else if menuTargetBubble.shape.type === BblShapeType.box}
			<ContextMenuOption labelText="Convert to Poly" on:click={handleConvertToPoly} />
			{/if}
			<ContextMenuOption labelText="Scan Text" />
			<ContextMenuDivider />
			<ContextMenuOption kind="danger" labelText="Delete" on:click={handleBubbleDelete} />
		{:else}
			{#if editable}
				<ContextMenuOption labelText="Scan Page" />
				<ContextMenuOption labelText="Scan Bubbles" />
				<ContextMenuDivider />
			{/if}
			<ContextMenuOption labelText="Language">
				<ContextMenuRadioGroup bind:selectedId={selectedLanguage}>
					<ContextMenuOption id="org" labelText="ORG" />
					{#each languages as lang}
						<ContextMenuOption id={lang} labelText={lang.toUpperCase()} />
					{/each}
				</ContextMenuRadioGroup>
			</ContextMenuOption>
			<ContextMenuOption labelText="Zoom">
				<ContextMenuRadioGroup bind:selectedId={selectedZoom}>
					{#each zoomLevels as {id, label}}
						<ContextMenuOption {id} labelText={label} />
					{/each}
				</ContextMenuRadioGroup>
			</ContextMenuOption>
		{/if}
	</ContextMenu>
</Content>

<style>
	.tree {
		overflow: auto;
		height: 100%;
	}
</style>
