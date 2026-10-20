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
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { PageImages, type PageImage } from '#lib/PageImages.js';
	import { isFullscreen } from '#lib/fullscreen.js';
	import {
		readSidebarSession,
		saveSidebarSession,
		readReadingHistory,
		saveReadingHistory,
		type ReadingPosition
	} from '#lib/stores/SidebarSession.js';
	import { preferredLanguage } from '#lib/stores/ReaderPreferences.js';
	import { BblShapeType, boundsv, vertex, type Bubble, type Comic } from '#lib/types/Comic.js';
	import { DirectoryComicStore, type ComicStore } from '#lib/types/ComicStore.js';
	import ComicsTree from '#lib/ComicsTree.svelte';
	import ReaderPage from '#lib/ReaderPage.svelte';
	import Zoom from '#lib/Zoom.svelte';
	import { dedup } from '#lib/types/funcs.js';

	let isSideNavOpen = $state(false);
	let fullscreen = $state(false);
	let readerUi: HTMLDivElement;

	function updateFullscreen() {
		fullscreen = isFullscreen();
		if (
			fullscreen &&
			document.activeElement instanceof HTMLElement &&
			readerUi?.contains(document.activeElement)
		) {
			document.activeElement.blur();
		}
	}

	onMount(() => {
		updateFullscreen();
		window.addEventListener('resize', updateFullscreen);
		document.addEventListener('fullscreenchange', updateFullscreen);
		return () => {
			window.removeEventListener('resize', updateFullscreen);
			document.removeEventListener('fullscreenchange', updateFullscreen);
		};
	});

	let selectedZoom: string = $state('fit');
	let pageMode = $state('2P');
	let pageViews = $state<ReaderPage[]>([]);
	const pageImages = new PageImages();
	let displayedPages = $state.raw<
		{ comic: Comic; image: PageImage; bubbles: Bubble[]; language: string }[]
	>([]);
	let pageLoadError = $state('');
	let loadingPages = $state(false);
	let spreadSize = $derived({
		width:
			displayedPages.reduce((width, page) => width + page.image.width, 0) +
			2 * Math.max(0, displayedPages.length - 1),
		height: Math.max(0, ...displayedPages.map((page) => page.image.height))
	});

	onDestroy(() => pageImages.retain([]));

	$effect(() => {
		const requested = visiblePages;
		const language = selectedLanguage;
		let cancelled = false;
		loadingPages = requested.length > 0;
		pageLoadError = '';
		pageImages.retain([...requested, ...untrack(() => displayedPages).map((page) => page.comic)]);
		void Promise.all(
			requested.map(async (comic) => {
				const [image, bubbles] = await Promise.all([
					pageImages.load(comic),
					comic.getBubbles(language)
				]);
				return { comic, image, bubbles, language };
			})
		)
			.then(async (pages) => {
				if (cancelled) return;
				displayedPages = pages;
				loadingPages = false;
				// Let the outgoing SVGs leave the DOM before revoking their image URLs.
				await tick();
				if (!cancelled) pageImages.retain(requested);
			})
			.catch((error) => {
				if (!cancelled) {
					pageLoadError = String(error);
					loadingPages = false;
				}
			});
		return () => {
			cancelled = true;
		};
	});

	let browserLanguages = $state<readonly string[]>([]);
	let selectedShape: BblShapeType = $state(BblShapeType.box);
	let selectedEdit: string = $state('no');

	let store: ComicStore | null = $state(null);
	let comics = writable<Comic[]>([]);
	let selectedComic = writable<Comic | null>(null);
	let directoryError = $state('');
	let savedDirectory = $state.raw<FileSystemDirectoryHandle>();
	let expandedIds = $state<string[]>([]);
	let restoringDirectory = $state(true);
	let persistenceError = $state('');
	let readingHistory: ReadingPosition[] = [];
	let readingPosition = $state.raw<ReadingPosition>();
	let savingReadingHistory = Promise.resolve();

	onMount(() => {
		browserLanguages = navigator.languages;
		try {
			const mode = localStorage.getItem('comix-sense.page-mode');
			if (mode === '1P' || mode === '2P') pageMode = mode;
			const zoom = localStorage.getItem('comix-sense.zoom');
			if (zoomLevels.some(({ id }) => id === zoom)) selectedZoom = zoom!;
		} catch {
			// Reading remains available when browser storage is disabled.
		}
		void (async () => {
			try {
				readingHistory = (await readReadingHistory()) ?? [];
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
		let position: ReadingPosition | undefined;
		for (const previous of readingHistory) {
			if (await directory.isSameEntry(previous.directory)) {
				position = previous;
				break;
			}
		}
		if (!position) {
			position = { directory, albumPages: {} };
			readingHistory.push(position);
		}
		readingPosition = position;
		comics.set(nextComics);
		store = nextStore;
		// Keep unavailable positions: permission renewal or a later reopen may restore them.
		selectedComic.set(
			nextComics.find((comic) => comic.kind === 'page' && comic.path === position.lastPage) ?? null
		);
	}

	function selectComic(comic: Comic) {
		selectedComic.set(comic);
		if (!readingPosition) return;
		const albumPath = comic.path.slice(0, comic.path.lastIndexOf('/') + 1);
		const position = {
			...readingPosition,
			lastPage: comic.path,
			albumPages: { ...readingPosition.albumPages, [albumPath]: comic.path }
		};
		readingHistory = readingHistory.map((entry) => (entry === readingPosition ? position : entry));
		readingPosition = position;
		persistReadingHistory();
	}

	function persistReadingHistory() {
		const snapshot = readingHistory;
		savingReadingHistory = savingReadingHistory
			.then(() => saveReadingHistory(snapshot))
			.then(() => {})
			.catch(() => {
				persistenceError = 'Could not save reading preferences for the next startup.';
			});
	}

	function navigatePage(direction: -1 | 1, singlePage = false) {
		if (!$selectedComic) return;
		const index = albumPages.indexOf($selectedComic);
		if (index < 0) return;
		const step = pageMode === '2P' && !singlePage ? 2 : 1;
		const next = albumPages[Math.max(0, index + direction * step)];
		if (next && next !== $selectedComic) selectComic(next);
	}

	function isNavigationControl(target: EventTarget | null) {
		return (
			target instanceof Element &&
			!!target.closest(
				'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="tree"], [role="menu"], [role="menubar"]'
			)
		);
	}

	function handleNavigationKey(event: KeyboardEvent) {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			isNavigationControl(event.target)
		)
			return;
		const key = event.key.toLowerCase();
		const mode = key === '1' || key === 's' ? '1P' : key === '2' || key === 'd' ? '2P' : undefined;
		if (mode) {
			event.preventDefault();
			if (pageMode !== mode) selectPageMode(mode);
			return;
		}
		if ($selectedComic && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
			event.preventDefault();
			navigatePage(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
		}
	}

	function handleNavigationClick(event: MouseEvent) {
		if (
			editable ||
			event.defaultPrevented ||
			event.button !== 0 ||
			isNavigationControl(event.target)
		)
			return;
		const pane = event.target instanceof Element ? event.target.closest('main') : null;
		if (!pane) return;
		const bounds = pane.getBoundingClientRect();
		const x = event.clientX - bounds.left;
		if (x < bounds.width * 0.25) navigatePage(-1, event.shiftKey);
		else if (x > bounds.width * 0.75) navigatePage(1, event.shiftKey);
	}

	let lastWheelAt = -Infinity;
	let lastWheelTurnAt = -Infinity;
	let lastWheelDirection = 0;

	function handleNavigationWheel(event: WheelEvent) {
		if (
			selectedZoom !== 'fit' ||
			editable ||
			event.defaultPrevented ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			!event.deltaY ||
			Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
			isNavigationControl(event.target) ||
			!(event.target instanceof Element) ||
			!event.target.closest('main .viewport')
		)
			return;
		event.preventDefault();
		const now = performance.now();
		const direction = event.deltaY < 0 ? -1 : 1;
		// Group short bursts, but let sustained scrolling turn again every 100ms.
		// A pause or direction reversal starts a fresh gesture immediately.
		const sameGesture = direction === lastWheelDirection && now - lastWheelAt < 250;
		lastWheelAt = now;
		lastWheelDirection = direction;
		if (loadingPages || (sameGesture && now - lastWheelTurnAt < 100)) return;
		lastWheelTurnAt = now;
		navigatePage(direction, event.shiftKey);
	}

	onMount(() => {
		window.addEventListener('wheel', handleNavigationWheel, { passive: false });
		return () => window.removeEventListener('wheel', handleNavigationWheel);
	});

	function selectZoom(zoom: string) {
		selectedZoom = zoom;
		try {
			localStorage.setItem('comix-sense.zoom', zoom);
		} catch {
			persistenceError = 'Could not save zoom for the next startup.';
		}
	}

	function selectLanguage(language: string) {
		if (!readingPosition || !$selectedComic) return;
		const position = {
			...readingPosition,
			albumLanguages: { ...readingPosition.albumLanguages, [albumPath]: language }
		};
		readingHistory = readingHistory.map((entry) => (entry === readingPosition ? position : entry));
		readingPosition = position;
		persistReadingHistory();
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

	let menuTargetBubble: Bubble | undefined = $state();
	let menuTargetBubbles: Bubble[] = [];

	function setupMenu(evt: CustomEvent<Element>) {
		menuTargetBubble = undefined;
		if (!editable) return;
		for (const view of pageViews) {
			const target = view?.getBubble(evt.detail);
			if (target) {
				menuTargetBubble = target.bubble;
				menuTargetBubbles = target.bubbles;
				break;
			}
		}
	}

	function selectPageMode(mode: string) {
		pageMode = mode;
		try {
			localStorage.setItem('comix-sense.page-mode', mode);
		} catch {
			persistenceError = 'Could not save page layout for the next startup.';
		}
	}

	function handleBubbleDelete() {
		if (menuTargetBubble) {
			const bbls = menuTargetBubbles;
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
	let editable = $derived(selectedEdit === 'yes' && !fullscreen);
	let albumPath = $derived(
		$selectedComic?.path.slice(0, $selectedComic.path.lastIndexOf('/') + 1) ?? ''
	);
	let albumPages = $derived(
		$comics.filter(
			(comic) =>
				comic.kind === 'page' && comic.path.slice(0, comic.path.lastIndexOf('/') + 1) === albumPath
		)
	);
	let visiblePages = $derived(
		$selectedComic
			? albumPages.slice(
					albumPages.indexOf($selectedComic),
					albumPages.indexOf($selectedComic) + (pageMode === '2P' ? 2 : 1)
				)
			: []
	);
	let languages = $derived(
		dedup(
			$comics
				.filter(
					(c) => c.kind === 'page' && c.path.slice(0, c.path.lastIndexOf('/') + 1) === albumPath
				)
				.flatMap((c) => c.languages)
		)
	);
	let selectedLanguage = $derived(
		preferredLanguage(readingPosition?.albumLanguages?.[albumPath], languages, browserLanguages)
	);
</script>

<svelte:window onkeydown={handleNavigationKey} onclick={handleNavigationClick} />

<div bind:this={readerUi} class="reader-shell" class:fullscreen>
	<Header platformName="Comix Sense" bind:isSideNavOpen>
		<!-- Carbon still exposes this named slot; Svelte 5 supports consuming it. -->
		<svelte:fragment slot="skipToContent">
			<SkipToContent />
		</svelte:fragment>
		<HeaderNav>
			<HeaderNavItem text="Link 1" />
			<HeaderNavItem text="Link 2" />

			<HeaderNavMenu href={resolve('/')} text={pageMode}>
				<TileGroup selected={pageMode} on:select={(event) => selectPageMode(event.detail)}>
					<RadioTile value="1P">1P</RadioTile>
					<RadioTile value="2P">2P</RadioTile>
				</TileGroup>
			</HeaderNavMenu>

			<HeaderNavMenu href={resolve('/')} text={selectedZoom.toUpperCase()}>
				<TileGroup selected={selectedZoom} on:select={(event) => selectZoom(event.detail)}>
					{#each zoomLevels as { id, label }}
						<RadioTile value={id}>{label}</RadioTile>
					{/each}
				</TileGroup>
			</HeaderNavMenu>

			<HeaderNavMenu
				href={resolve('/')}
				text={selectedLanguage ? selectedLanguage.toUpperCase() : 'ORG'}
			>
				<TileGroup selected={selectedLanguage} on:select={(event) => selectLanguage(event.detail)}>
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
					albumPages={readingPosition?.albumPages}
					onselect={selectComic}
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

	<Content
		style={fullscreen ? 'padding: 0; margin: 0; min-height: 0' : 'padding: 0'}
		class="fullsize"
	>
		{#if pageLoadError && !fullscreen}<p role="alert">{pageLoadError}</p>{/if}
		{#if displayedPages.length}
			<Zoom level={selectedZoom} contentSize={spreadSize} centered={fullscreen}>
				{#each displayedPages as page, i (page.comic)}
					<ReaderPage
						bind:this={pageViews[i]}
						comic={page.comic}
						image={page.image}
						loadedBubbles={page.bubbles}
						language={page.language}
						{editable}
						{selectedShape}
					/>
					{#if i < displayedPages.length - 1}
						<div
							class="page-separator"
							style:height="{spreadSize.height}px"
							aria-hidden="true"
						></div>
					{/if}
				{/each}
			</Zoom>
		{:else if loadingPages}
			Loading page...
		{:else}
			Select a comic from the left
		{/if}

		{#if !fullscreen}
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
						<ContextMenuRadioGroup selectedId={selectedLanguage}>
							<ContextMenuOption id="org" labelText="ORG" on:click={() => selectLanguage('org')} />
							{#each languages as lang}
								<ContextMenuOption
									id={lang}
									labelText={lang.toUpperCase()}
									on:click={() => selectLanguage(lang)}
								/>
							{/each}
						</ContextMenuRadioGroup>
					</ContextMenuOption>
					<ContextMenuOption labelText="Zoom">
						<ContextMenuRadioGroup selectedId={selectedZoom}>
							{#each zoomLevels as { id, label }}
								<ContextMenuOption {id} labelText={label} on:click={() => selectZoom(id)} />
							{/each}
						</ContextMenuRadioGroup>
					</ContextMenuOption>
				{/if}
			</ContextMenu>
		{/if}
	</Content>
</div>

<style>
	.page-separator {
		flex: 0 0 2px;
		background: #b3b3b3;
	}
	.reader-shell.fullscreen > :global(.bx--header),
	.reader-shell.fullscreen > :global(.bx--side-nav),
	.reader-shell.fullscreen > :global(.bx--side-nav__overlay) {
		display: none;
	}
	.tree {
		overflow: auto;
		height: 100%;
	}
</style>
