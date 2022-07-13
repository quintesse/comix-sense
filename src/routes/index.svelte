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
		RadioTile
	} from 'carbon-components-svelte';
	import { base } from "$app/paths";
	import { writable } from 'svelte/store';
	import { collectionStore } from '$lib/stores/CollectionStore';
	import { BblShapeType, type BblShape, type Bubble, type Comic } from '$lib/types/Comic';
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
		console.log("NEW BUBBLE", evt);
		$bubbles.push({ text: "", shape: evt.detail } as Bubble);
		bubbles.set($bubbles);
	}
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
				<RadioTile value="fit">Fit</RadioTile>
				<RadioTile value="width">Width</RadioTile>
				<RadioTile value="100%">100%</RadioTile>
				<RadioTile value="75%">75%</RadioTile>
				<RadioTile value="50%">50%</RadioTile>
				<RadioTile value="25%">25%</RadioTile>
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
				{#each $bubbles as bubble}
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
</Content>

<style>
	.tree {
		overflow: auto;
		height: 100%;
	}
</style>
