<script lang="ts">
	import 'carbon-components-svelte/css/white.css';
	import {
		Header,
		HeaderNav,
		HeaderNavItem,
		HeaderNavMenu,
		SideNav,
		SkipToContent,
		Content,
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
		ContextMenuRadioGroup
	} from 'carbon-components-svelte';
	import { resolve } from '$app/paths';
	import { writable } from 'svelte/store';
	import { onMount } from 'svelte';
	import { readSidebarSession, saveSidebarSession } from '#lib/stores/SidebarSession.js';
	import { collectionStore } from '#lib/stores/CollectionStore.js';
	import {
		BblShapeType,
		boundsv,
		vertex,
		type BblShape,
		type Bubble,
		type Comic
	} from '#lib/types/Comic.js';
	import { DirectoryComicStore, type ComicStore } from '#lib/types/ComicStore.js';
	import ComicsTree from '#lib/ComicsTree.svelte';
	import ComicPage from '#lib/ComicPage.svelte';
	import ComicBubble from '#lib/ComicBubble.svelte';
	import Zoom from '#lib/Zoom.svelte';
	import { dedup } from '#lib/types/funcs.js';

	let isSideNavOpen = $state(false);

	let selectedZoom: string = $state('width');
	let selectedLanguage: string = $state('org');
	let selectedShape: BblShapeType = $state(BblShapeType.box);
	let selectedEdit: string = $state('no');

	let store: ComicStore | null = $state(null);
	let comics = writable<Comic[]>([]);
	let selectedComic = writable<Comic | null>(null);
	let collection = collectionStore(comics, selectedComic);
	let bubbles = $state<Bubble[]>([]);
	let imageUrl = $state<string>();
	let loadError = $state('');
	let directoryError = $state('');
	let savedDirectory = $state.raw<FileSystemDirectoryHandle>();
	let expandedIds = $state<string[]>([]);
	let restoringDirectory = $state(true);
	let persistenceError = $state('');

	onMount(() => {
		void (async () => {
			try {
				const session = await readSidebarSession();
				if (session) {
					savedDirectory = session.directory;
					expandedIds = session.expandedIds;
					if ((await session.directory.queryPermission({ mode: 'read' })) === 'granted')
						await openDirectory(session.directory);
				}
			} catch (error) {
				directoryError = 'Could not restore the previous directory: ' + String(error);
			} finally {
				restoringDirectory = false;
			}
		})();
	});

	$effect(() => {
		if (store && savedDirectory && !restoringDirectory) {
			void saveSidebarSession({ directory: savedDirectory, expandedIds: [...expandedIds] }).catch(
				() => {
					persistenceError = 'Could not save the sidebar for the next startup.';
				}
			);
		}
	});

	async function openDirectory(directory: FileSystemDirectoryHandle) {
		const nextStore = new DirectoryComicStore(directory);
		const nextComics = await nextStore.list();
		selectedComic.set(null);
		comics.set(nextComics);
		store = nextStore;
	}

	async function reopenDirectory() {
		directoryError = '';
		try {
			if (
				savedDirectory &&
				(await savedDirectory.requestPermission({ mode: 'read' })) === 'granted'
			)
				await openDirectory(savedDirectory);
			else directoryError = 'Directory access was not granted. Reopen it or select a directory.';
		} catch (error) {
			directoryError = 'Could not reopen the directory: ' + String(error);
		}
	}

	$effect(() => {
		const comic = $selectedComic;
		const language = selectedLanguage;
		let cancelled = false;
		bubbles = [];
		loadError = '';
		if (comic) {
			comic
				.getBubbles(language)
				.then((loaded) => {
					if (cancelled) return;
					bubbles = loaded;
					comic.setBubbles(language, bubbles);
				})
				.catch((error) => {
					if (!cancelled) loadError = String(error);
				});
		}
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const comic = $selectedComic;
		let cancelled = false;
		let resource: string | undefined;
		imageUrl = undefined;
		if (comic) {
			comic
				.getImageUrl()
				.then((url) => {
					if (cancelled) URL.revokeObjectURL(url);
					else imageUrl = resource = url;
				})
				.catch((error) => {
					if (!cancelled) loadError = String(error);
				});
		}
		return () => {
			cancelled = true;
			if (resource) URL.revokeObjectURL(resource);
		};
	});

	async function selectDirectory() {
		directoryError = '';
		try {
			if (!window.showDirectoryPicker)
				throw new Error(
					'Opening a directory requires a browser with File System Access support, such as Chrome or Edge.'
				);
			const comicsFolder = await window.showDirectoryPicker();
			await openDirectory(comicsFolder);
			expandedIds = [];
			savedDirectory = comicsFolder;
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError'))
				directoryError = String(error);
		}
	}

	function handleNewBubble(shape: BblShape) {
		bubbles.push({ text: '', shape });
	}

	let menuTargetBubble: Bubble | undefined = $state();

	function setupMenu(evt: CustomEvent<Element>) {
		const target = evt.detail;
		const element = target instanceof Element ? target.closest('foreignObject') : null;
		const index = element?.getAttribute('data-bubble-index');
		menuTargetBubble = editable && index != null ? bubbles[Number(index)] : undefined;
	}

	function handleBubbleDelete() {
		if (menuTargetBubble) {
			const bbls = bubbles;
			const idx = bbls.indexOf(menuTargetBubble);
			if (idx >= 0) {
				bbls.splice(idx, 1);
			}
		}
	}

	function handleConvertToBox() {
		if (menuTargetBubble && menuTargetBubble.shape.type === BblShapeType.poly) {
			const shp = menuTargetBubble.shape;
			shp.type = BblShapeType.box;
			shp.vs = boundsv(shp.vs);
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
		}
	}

	const zoomLevels = [
		{ id: 'fit', label: 'Fit' },
		{ id: 'width', label: 'Width' },
		{ id: '200%', label: '200%' },
		{ id: '175%', label: '175%' },
		{ id: '150%', label: '150%' },
		{ id: '125%', label: '125%' },
		{ id: '100%', label: '100%' },
		{ id: '75%', label: '75%' },
		{ id: '50%', label: '50%' },
		{ id: '25%', label: '25%' }
	];
	let editable = $derived(selectedEdit === 'yes');
	let languages = $derived(dedup($collection.flatMap((c) => c.languages)));
</script>

<Header platformName="Comix Sense" bind:isSideNavOpen>
	<!-- Carbon still exposes this named slot; Svelte 5 supports consuming it. -->
	<svelte:fragment slot="skipToContent">
		<SkipToContent />
	</svelte:fragment>
	<HeaderNav>
		<HeaderNavItem text="Link 1" />
		<HeaderNavItem text="Link 2" />

		<HeaderNavMenu href={resolve('/')} text={selectedZoom.toUpperCase()}>
			<TileGroup bind:selected={selectedZoom}>
				{#each zoomLevels as { id, label }}
					<RadioTile value={id}>{label}</RadioTile>
				{/each}
			</TileGroup>
		</HeaderNavMenu>

		<HeaderNavMenu
			href={resolve('/')}
			text={selectedLanguage ? selectedLanguage.toUpperCase() : 'ORG'}
		>
			<TileGroup bind:selected={selectedLanguage}>
				<RadioTile value="org">ORG</RadioTile>
				{#each languages as lang}
					<RadioTile value={lang}>{lang.toUpperCase()}</RadioTile>
				{/each}
			</TileGroup>
		</HeaderNavMenu>

		<HeaderNavMenu href={resolve('/')} text={'EDIT: ' + selectedEdit.toUpperCase()}>
			<TileGroup bind:selected={selectedEdit}>
				<RadioTile value="yes">Yes</RadioTile>
				<RadioTile value="no">No</RadioTile>
			</TileGroup>
		</HeaderNavMenu>
		{#if editable}
			<HeaderNavMenu href={resolve('/')} text={selectedShape.toUpperCase()}>
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
				selectedComic={$selectedComic}
				bind:expandedIds
				onselect={(comic) => selectedComic.set(comic)}
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
	{:else if restoringDirectory}
		<p>Restoring directory...</p>
	{:else}
		<div>
			{#if savedDirectory}
				<Button on:click={reopenDirectory}>Reopen {savedDirectory.name}</Button>
			{/if}
			<Button on:click={selectDirectory}>Select directory...</Button>
		</div>
	{/if}
	{#if directoryError}<p role="alert">{directoryError}</p>{/if}
	{#if persistenceError}<p role="status">{persistenceError}</p>{/if}
</SideNav>

<Content style="padding: 0" class="fullsize">
	{#if loadError}<p role="alert">{loadError}</p>{/if}
	{#if $selectedComic && imageUrl}
		<Zoom level={selectedZoom}>
			<ComicPage img={imageUrl} {editable} {selectedShape} onshape={handleNewBubble}>
				{#snippet children({ renderMode })}
					{#each bubbles as bubble, i (bubble)}
						<ComicBubble bind:bubble={bubbles[i]} bubbleIndex={i} {renderMode} {editable} />
					{/each}
				{/snippet}
			</ComicPage>
		</Zoom>
	{:else if $selectedComic}
		Loading page...
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
					{#each zoomLevels as { id, label }}
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
