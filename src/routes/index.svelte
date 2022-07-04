<script lang="ts">
	import 'carbon-components-svelte/css/white.css';
	import {
		Header, HeaderNav, HeaderNavItem, HeaderNavMenu,
		SideNav,
		SkipToContent, Content,
		//
		FileUploaderDropContainer,
		//
		Button
	} from 'carbon-components-svelte';
	import { base } from "$app/paths";
	import ComicsTree from '$lib/ComicsTree.svelte';
	import type { Comic } from '$lib/types/Comic';
	import ComicPage from '$lib/ComicPage.svelte';
	import Zoom from '$lib/Zoom.svelte';
	import { DirectoryComicStore, type ComicStore } from '$lib/types/ComicStore';

	let isSideNavOpen = false;

	let selectedComic: Comic|null = null;

	let comicsp: ComicStore|null = null; //new DummyComicStore();

	async function selectDirectory() {
		let comicsFolder = await window.showDirectoryPicker();
		//comicsp = new DummyComicStore();
		comicsp = new DirectoryComicStore(comicsFolder);
	}
</script>

<Header platformName="Comix Sense" bind:isSideNavOpen>
	<svelte:fragment slot="skip-to-content">
		<SkipToContent />
	</svelte:fragment>
	<HeaderNav>
		<HeaderNavItem href="{base}/" text="Link 1" />
		<HeaderNavItem href="{base}/" text="Link 2" />
		<HeaderNavItem href="{base}/" text="Link 3" />
		<HeaderNavMenu text="Menu" href="{base}#">
			<HeaderNavItem href="{base}/" text="Link 1" />
			<HeaderNavItem href="{base}/" text="Link 2" />
			<HeaderNavItem href="{base}/" text="Link 3" />
		</HeaderNavMenu>
		<HeaderNavItem href="{base}/" text="Link 4" />
	</HeaderNav>
</Header>

<SideNav bind:isOpen={isSideNavOpen}>
	{#if comicsp}
		{#await comicsp.list()}
			Loading...
		{:then comics}
			<div class="tree">
				<ComicsTree
					{comics}
					bind:selectedComic
				/>
			</div>
			<FileUploaderDropContainer
				multiple
				labelText="Drag and drop files here or click to upload"
				validateFiles={(files) => {
					return files.filter((file) => file.type.startsWith("image/"));
				}}
				on:change={(e) => {
					console.log('files', e.detail);
				}}
			/>
		{/await}
	{:else}
		<div>
			<Button on:click={selectDirectory}>Select directory...</Button>
		</div>
	{/if}
</SideNav>

<Content style="padding: 0" class="fullsize">
	{#if selectedComic}
		<Zoom level="width">
			<ComicPage comic={selectedComic}>
			</ComicPage>
		</Zoom>
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
