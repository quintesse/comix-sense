<script lang="ts">
	import 'carbon-components-svelte/css/white.css';
	import {
		Header,
		HeaderNav,
		HeaderNavMenu,
		SideNav,
		SkipToContent,
		Content,
		//
		Button,
		Modal,
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
		type ReadingPosition,
		type SidebarDirectory
	} from '#lib/stores/SidebarSession.js';
	import { preferredLanguage } from '#lib/stores/ReaderPreferences.js';
	import { BblShapeType, boundsv, vertex, type Bubble, type Comic } from '#lib/types/Comic.js';
	import { DirectoryComicStore } from '#lib/types/ComicStore.js';
	import type { ComicFolder } from '#lib/types/ComicFolder.js';
	import ComicsTree from '#lib/ComicsTree.svelte';
	import AlbumPages from '#lib/AlbumPages.svelte';
	import SidebarPanes from '#lib/SidebarPanes.svelte';
	import ReaderPage from '#lib/ReaderPage.svelte';
	import Zoom from '#lib/Zoom.svelte';
	import ToolbarIcon from '#lib/icons/ToolbarIcon.svelte';
	import LanguageMenu from '#lib/LanguageMenu.svelte';
	import OcrSettings from '#lib/OcrSettings.svelte';
	import { scanImage } from '#lib/ocr.js';
	import { mergeBubbles } from '#lib/mergeBubbles.js';
	import { releaseImageUrl } from '#lib/ImageUrls.js';
	import { dedup } from '#lib/types/funcs.js';

	let ocrKey = $state('');
	const externalVisionKey = import.meta.env.GOOGLE_VISION_KEY;
	let effectiveOcrKey = $derived(externalVisionKey || ocrKey);
	let ocrSettingsOpen = $state(false);
	let overwriteOcrOpen = $state(false);
	let overwriteOcrComic = $state.raw<Comic>();
	let scanAfterSettings = false;
	let scanning = $state(false);
	let scanMessage = $state('');
	let scanError = $state('');
	let scanController: AbortController | undefined;

	function dismissScanFeedback() {
		scanMessage = '';
		scanError = '';
	}

	$effect(() => {
		if (!scanning && scanMessage) {
			const timer = window.setTimeout(dismissScanFeedback, 6000);
			return () => window.clearTimeout(timer);
		}
	});

	function requestScan() {
		if (!effectiveOcrKey) {
			scanAfterSettings = true;
			ocrSettingsOpen = true;
		} else void scanPage();
	}

	function confirmOcrOverwrite() {
		const comic = overwriteOcrComic;
		overwriteOcrOpen = false;
		overwriteOcrComic = undefined;
		if (comic && comic === $selectedComic) void scanPage(comic);
	}

	async function scanPage(confirmedComic?: Comic) {
		const comic = $selectedComic;
		if (!comic || scanning || !editable || loadingPages) return;
		const key = effectiveOcrKey;
		const ocrLanguage = comic.languages.find((lang) => lang.toLowerCase() === 'ocr') ?? 'OCR';
		const mergedLanguage = comic.languages.find((lang) => lang.toLowerCase() === 'mrg') ?? 'MRG';
		if (
			(comic.languages.includes(ocrLanguage) || comic.languages.includes(mergedLanguage)) &&
			confirmedComic !== comic
		) {
			overwriteOcrComic = comic;
			overwriteOcrOpen = true;
			return;
		}
		scanning = true;
		scanError = '';
		scanMessage = `Scanning ${comic.displayName}…`;
		const controller = new AbortController();
		scanController = controller;
		const release = comic.protectImage();
		let url: string | undefined;
		try {
			const previous = await Promise.all(
				[ocrLanguage, mergedLanguage].map(async (language) =>
					comic.languages.includes(language) ? await comic.getBubbles(language) : []
				)
			);
			const baseline = JSON.stringify(previous);
			url = await comic.getImageUrl();
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) throw new Error('Could not read the page image.');
			const result = await scanImage(await response.blob(), key, controller.signal);
			if (controller.signal.aborted || !folders.some((folder) => folder.comics.includes(comic))) {
				scanMessage = '';
				return;
			}
			if (JSON.stringify(previous) !== baseline)
				throw new Error('A scan overlay was edited during scanning. Scan again to replace it.');
			const merged = result.bubbles.some((bubble) => bubble.text.trim())
				? mergeBubbles(result.bubbles)
				: undefined;
			await comic.editBubbles(ocrLanguage, result.bubbles);
			if (merged) await comic.editBubbles(mergedLanguage, merged);
			comic.setBubbles(ocrLanguage, result.bubbles);
			if (merged) comic.setBubbles(mergedLanguage, merged);
			comic.languages = [
				...new Set([...comic.languages, ocrLanguage, ...(merged ? [mergedLanguage] : [])])
			];
			comics.update((values) => [...values]);
			if ($selectedComic === comic) {
				selectLanguage(merged ? mergedLanguage : ocrLanguage);
				showBubbles = true;
				// Refresh either scan overlay if it is already displayed.
				displayedPages = displayedPages.map((page) =>
					page.comic === comic &&
					(page.language === ocrLanguage || (merged && page.language === mergedLanguage))
						? { ...page, bubbles: page.language === ocrLanguage ? result.bubbles : merged! }
						: page
				);
			}
			scanMessage = merged
				? `${comic.displayName}: ${result.bubbles.length} words recognized, ${merged.length} merged regions. Browser backup scheduled.`
				: `${comic.displayName}: No text recognized. No MRG overlay was created.`;
		} catch (error) {
			if (!controller.signal.aborted)
				scanError = 'Scan failed: ' + (error instanceof Error ? error.message : String(error));
			scanMessage = '';
		} finally {
			if (url) releaseImageUrl(url);
			release();
			scanning = false;
			scanController = undefined;
		}
	}

	let isSideNavOpen = $state(false);
	let comicsTree: ComicsTree | undefined = $state();
	let albumPageList: AlbumPages | undefined = $state();

	async function locatePage() {
		if (!$selectedComic) return;
		isSideNavOpen = true;
		await tick();
		await comicsTree?.locate();
		albumPageList?.locate();
	}
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

	onDestroy(() => {
		scanController?.abort();
		pageImages.retain([]);
		for (const folder of folders) folder.store.dispose();
	});

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
					pageImages.retain(displayedPages.map((page) => page.comic));
				}
			});
		return () => {
			cancelled = true;
		};
	});

	let browserLanguages = $state<readonly string[]>([]);
	let selectedShape: BblShapeType = $state(BblShapeType.box);
	let selectedEdit: string = $state('no');
	let showBubbles = $state(true);

	let folders = $state.raw<ComicFolder[]>([]);
	let savedDirectories = $state.raw<SidebarDirectory[]>([]);
	let activeDirectoryId = $state<string>();
	let comics = writable<Comic[]>([]);
	let selectedComic = writable<Comic | null>(null);
	let directoryError = $state('');
	let expandedIds = $state<string[]>([]);
	let restoringDirectory = $state(true);
	let noSources = $derived(!restoringDirectory && savedDirectories.length === 0);
	let persistenceError = $state('');
	let readingHistory: ReadingPosition[] = [];
	let readingPosition = $state.raw<ReadingPosition>();
	let savingReadingHistory = Promise.resolve();
	let disconnectFolder = $state.raw<ComicFolder>();
	let disconnectOpen = $state(false);
	let activeFolder = $derived(folders.find((folder) => folder.id === activeDirectoryId));
	let pendingChanges = $state(0);
	let pendingLanguages = $state.raw<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
	let documentTargets = $state.raw<ReadonlyMap<string, string>>(new Map());
	let unsavedLanguages = $derived(
		pendingLanguages.get($selectedComic?.path ?? '') ?? new Set<string>()
	);
	let backupError = $state('');
	let changesBusy = $state(false);
	let changesMessage = $state('');
	let changesError = $state('');
	let discardFolder = $state.raw<ComicFolder>();
	let discardDocument = $state('');
	let discardOpen = $state(false);

	$effect(() => {
		const workspace = activeFolder?.store.workspace;
		pendingChanges = 0;
		pendingLanguages = new Map();
		backupError = '';
		const pending = workspace?.pending.subscribe((value) => (pendingChanges = value));
		const error = workspace?.error.subscribe((value) => (backupError = value));
		const languages = workspace?.pendingLanguages.subscribe((value) => (pendingLanguages = value));
		return () => {
			pending?.();
			error?.();
			languages?.();
		};
	});
	$effect(() => {
		documentTargets = new Map();
		return $selectedComic?.documentTargets.subscribe((value) => (documentTargets = value));
	});

	async function reloadFolder(folder: ComicFolder) {
		const store = new DirectoryComicStore(folder.directory);
		const nextComics = await store.list();
		const selectedPath = $selectedComic?.path;
		const archive = nextComics.find(
			(comic) => comic.kind === 'archive' && selectedPath?.startsWith(comic.path + '/')
		);
		if (archive) {
			const pages = await store.archive(archive.path).list();
			nextComics.splice(nextComics.indexOf(archive) + 1, 0, ...pages);
		}
		const replacement = { ...folder, store, comics: nextComics };
		folders = folders.map((entry) => (entry === folder ? replacement : entry));
		if (activeDirectoryId === folder.id)
			activateFolder(
				replacement,
				nextComics.find((comic) => comic.path === selectedPath)
			);
		await tick();
		folder.store.dispose();
	}

	async function saveChanges() {
		const folder = activeFolder;
		const document = currentDocument;
		if (!folder || !document || changesBusy || scanning) return;
		changesBusy = true;
		changesMessage = changesError = '';
		try {
			await folder.store.workspace.save(document);
			await reloadFolder(folder);
			changesMessage = `Saved changes to “${document}”.`;
		} catch (error) {
			changesError = 'Could not save changes: ' + String(error);
		} finally {
			changesBusy = false;
		}
	}

	async function discardChanges() {
		const folder = discardFolder;
		const document = discardDocument;
		discardOpen = false;
		discardFolder = undefined;
		if (!folder || !document || changesBusy) return;
		changesBusy = true;
		changesMessage = changesError = '';
		try {
			await folder.store.workspace.discard(document);
			await reloadFolder(folder);
			changesMessage = `Changes to “${document}” discarded.`;
		} catch (error) {
			changesError = 'Could not discard changes: ' + String(error);
		} finally {
			changesBusy = false;
		}
	}

	function requestDisconnect(folder: ComicFolder) {
		disconnectFolder = folder;
		disconnectOpen = true;
	}

	async function confirmDisconnect() {
		const folder = disconnectFolder;
		if (!folder) return;
		disconnectOpen = false;
		disconnectFolder = undefined;
		archiveSelection++;
		folder.store.dispose();
		folders = folders.filter((entry) => entry.id !== folder.id);
		savedDirectories = savedDirectories.filter((entry) => entry.id !== folder.id);
		expandedIds = expandedIds.filter((id) => id !== folder.id && !id.startsWith(folder.id + '/'));
		if (activeDirectoryId === folder.id) {
			selectedComic.set(null);
			comics.set([]);
			activeDirectoryId = undefined;
			readingPosition = undefined;
			menuTargetBubble = undefined;
			menuTargetBubbles = [];
		}
		if (displayedPages.some((page) => folder.comics.includes(page.comic))) {
			displayedPages = [];
			pageLoadError = '';
		}
		await tick();
		(
			readerUi.querySelector<HTMLElement>('.tree [role="treeitem"]') ??
			readerUi.querySelector<HTMLButtonElement>('.add-folder')
		)?.focus();
	}

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
		const restorationSelection = archiveSelection;
		void (async () => {
			try {
				readingHistory = (await readReadingHistory()) ?? [];
				const session = await readSidebarSession();
				if (session) {
					savedDirectories =
						session.directories ??
						(session.directory ? [{ id: crypto.randomUUID(), directory: session.directory }] : []);
					expandedIds = session.directories
						? session.expandedIds
						: savedDirectories.flatMap(({ id }) => [
								id,
								...session.expandedIds.map((childId) => `${id}/${childId}`)
							]);
					for (const saved of savedDirectories) {
						try {
							if ((await saved.directory.queryPermission({ mode: 'read' })) === 'granted')
								await openDirectory(saved);
						} catch (error) {
							directoryError = 'Could not restore ' + saved.directory.name + ': ' + String(error);
						}
					}
					const active =
						folders.find((folder) => folder.id === session.activeDirectoryId) ?? folders[0];
					if (active && restorationSelection === archiveSelection) activateFolder(active);
				}
			} catch (error) {
				directoryError = 'Could not restore the previous directory: ' + String(error);
			} finally {
				restoringDirectory = false;
			}
		})();
	});

	$effect(() => {
		if (!restoringDirectory) {
			void saveSidebarSession({
				directories: savedDirectories,
				activeDirectoryId,
				expandedIds: [...expandedIds]
			}).catch(() => {
				persistenceError = 'Could not save the sidebar for the next startup.';
			});
		}
	});

	async function openDirectory(saved: SidebarDirectory, expand = false) {
		const { directory } = saved;
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
		position.directory = directory;
		const folder: ComicFolder = {
			...saved,
			comics: nextComics,
			store: nextStore,
			albumPages: position.albumPages
		};
		// Restore lazy archive identities only after permission and directory enumeration.
		const archived = nextComics.find(
			(c) => c.kind === 'archive' && position!.lastPage?.startsWith(c.path + '/')
		);
		if (archived) {
			try {
				const pages = await nextStore.archive(archived.path).list();
				nextComics.splice(nextComics.indexOf(archived) + 1, 0, ...pages);
			} catch (error) {
				directoryError = 'Could not restore archive: ' + String(error);
			}
		}
		folders = [...folders, folder];
		if (expand) expandedIds = [...expandedIds, folder.id];
		if (!restoringDirectory) activateFolder(folder);
	}

	function activateFolder(folder: ComicFolder, comic?: Comic) {
		const position = readingHistory.find((entry) => entry.directory === folder.directory)!;
		activeDirectoryId = folder.id;
		readingPosition = position;
		comics.set(folder.comics);
		selectedComic.set(
			comic ??
				folder.comics.find((comic) => comic.kind === 'page' && comic.path === position.lastPage) ??
				null
		);
	}

	let archiveSelection = 0;
	async function openArchive(archive: Comic, select = true) {
		let folder = folders.find((f) => f.comics.includes(archive));
		if (!folder) return;
		const request = select ? ++archiveSelection : archiveSelection;
		if (select) {
			directoryError = '';
			for (const root of folders)
				root.store.cancelArchives(root.id === folder.id ? archive.path : undefined);
		}
		const publish = () => {
			folders = folders.map((f) =>
				f.id === folder!.id ? { ...f, comics: [...folder!.comics] } : f
			);
			if (activeDirectoryId === folder!.id) comics.set(folder!.comics);
		};
		const indexed = folder.comics.some((c) => c.album === archive.path);
		if (!indexed) archive.archiveState = 'loading';
		publish();
		try {
			const pages = await folder.store.archive(archive.path).list();
			folder = folders.find((f) => f.id === folder!.id);
			if (!folder) return;
			if (!folder.comics.includes(pages[0]))
				folder.comics.splice(folder.comics.indexOf(archive) + 1, 0, ...pages);
			archive.archiveState = undefined;
			publish();
			if (select && request === archiveSelection)
				selectComic(pages.find((p) => p.path === folder!.albumPages[archive.path]) ?? pages[0]);
		} catch (error) {
			if (!folders.some((f) => f.id === folder!.id)) return;
			archive.archiveState = 'error';
			publish();
			directoryError = 'Could not open ' + archive.fileName + ': ' + String(error);
		}
	}
	function selectComic(comic: Comic) {
		archiveSelection++;
		for (const root of folders)
			root.store.cancelArchives(root.comics.includes(comic) ? comic.album : undefined);
		const folder = folders.find((folder) => folder.comics.includes(comic));
		if (folder) activateFolder(folder, comic);
		else selectedComic.set(comic);
		if (!readingPosition) return;
		const albumPath = comic.albumPath;
		const position = {
			...readingPosition,
			lastPage: comic.path,
			albumPages: { ...readingPosition.albumPages, [albumPath]: comic.path }
		};
		readingHistory = readingHistory.map((entry) => (entry === readingPosition ? position : entry));
		readingPosition = position;
		folders = folders.map((folder) =>
			folder.id === activeDirectoryId ? { ...folder, albumPages: position.albumPages } : folder
		);
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
			disconnectOpen ||
			ocrSettingsOpen ||
			overwriteOcrOpen ||
			event.defaultPrevented ||
			event.isComposing ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		)
			return;
		const key = event.key.toLowerCase();
		if (
			key === 'b' &&
			!(
				event.target instanceof Element &&
				event.target.closest(
					'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
				)
			)
		) {
			event.preventDefault();
			if (!event.repeat) showBubbles = !showBubbles;
			return;
		}
		if (isNavigationControl(event.target)) return;
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

	function handlePageNavigationKey(event: KeyboardEvent) {
		const key = event.key.toLowerCase();
		if (
			(key === 'l' || key === 'r' || key === 'e') &&
			!(
				event.target instanceof Element &&
				event.target.closest(
					'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
				)
			) &&
			!disconnectOpen &&
			!ocrSettingsOpen &&
			!overwriteOcrOpen &&
			!event.defaultPrevented &&
			!event.isComposing &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			(key !== 'l' || $selectedComic)
		) {
			event.preventDefault();
			event.stopPropagation();
			if (!event.repeat) {
				if (key === 'l') void locatePage();
				else selectedEdit = key === 'e' ? 'yes' : 'no';
			}
			return;
		}
		if (
			disconnectOpen ||
			ocrSettingsOpen ||
			overwriteOcrOpen ||
			(event.key !== 'PageUp' && event.key !== 'PageDown') ||
			event.defaultPrevented ||
			event.isComposing ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			!$selectedComic
		)
			return;
		// Capture these app-wide shortcuts before controls such as the tree consume them.
		event.preventDefault();
		event.stopPropagation();
		navigatePage(event.key === 'PageUp' ? -1 : 1, event.shiftKey);
	}

	onMount(() => {
		window.addEventListener('keydown', handlePageNavigationKey, true);
		return () => window.removeEventListener('keydown', handlePageNavigationKey, true);
	});

	function handleNavigationClick(event: MouseEvent) {
		if (
			editable ||
			event.defaultPrevented ||
			event.button !== 0 ||
			isNavigationControl(event.target)
		)
			return;
		const pane = event.target instanceof Element ? event.target.closest('main') : null;
		const pages = pane?.querySelectorAll<SVGSVGElement>('svg[aria-label="Comic page"]');
		if (!pages?.length) return;
		const bounds = [...pages].map((page) => page.getBoundingClientRect());
		// Only artwork is clickable, including when spread pages have different heights.
		if (
			!bounds.some(
				(page) =>
					event.clientX >= page.left &&
					event.clientX < page.right &&
					event.clientY >= page.top &&
					event.clientY < page.bottom
			)
		)
			return;
		const left = Math.min(...bounds.map((page) => page.left));
		const right = Math.max(...bounds.map((page) => page.right));
		const x = event.clientX - left;
		if (x < (right - left) * 0.25) navigatePage(-1, event.shiftKey);
		else if (x > (right - left) * 0.75) navigatePage(1, event.shiftKey);
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

	async function reopenDirectory(saved: SidebarDirectory) {
		directoryError = '';
		try {
			if ((await saved.directory.requestPermission({ mode: 'read' })) === 'granted')
				await openDirectory(saved);
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
			for (const saved of savedDirectories) {
				if (await comicsFolder.isSameEntry(saved.directory)) {
					if (!folders.some((folder) => folder.id === saved.id)) await openDirectory(saved);
					return;
				}
			}
			const saved = { id: crypto.randomUUID(), directory: comicsFolder };
			await openDirectory(saved, true);
			savedDirectories = [...savedDirectories, saved];
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError'))
				directoryError = String(error);
		}
	}

	let menuTargetBubble: Bubble | undefined = $state();
	let menuTargetBubbles: Bubble[] = [];
	let menuTargetPointIndex = $state<number>();

	function setupMenu(evt: CustomEvent<Element>) {
		menuTargetBubble = undefined;
		menuTargetPointIndex = undefined;
		if (!editable || !showBubbles) return;
		for (const view of pageViews) {
			const target = view?.getBubble(evt.detail);
			if (target) {
				menuTargetBubble = target.bubble;
				menuTargetBubbles = target.bubbles;
				menuTargetPointIndex = target.pointIndex;
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

	function handlePointDelete() {
		const shape = menuTargetBubble?.shape;
		if (
			shape?.type === BblShapeType.poly &&
			shape.vs.length > 3 &&
			menuTargetPointIndex != null &&
			menuTargetPointIndex >= 0 &&
			menuTargetPointIndex < shape.vs.length
		) {
			shape.vs.splice(menuTargetPointIndex, 1);
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
	let editable = $derived(selectedEdit === 'yes' && !fullscreen && !changesBusy && !discardOpen);
	let albumPath = $derived($selectedComic?.albumPath ?? '');
	let albumPages = $derived(
		$comics.filter((comic) => comic.kind === 'page' && comic.albumPath === albumPath)
	);
	let visiblePages = $derived(
		$selectedComic
			? albumPages.slice(
					albumPages.indexOf($selectedComic),
					albumPages.indexOf($selectedComic) + (pageMode === '2P' ? 2 : 1)
				)
			: []
	);
	let pageLanguages = $derived($comics.find((comic) => comic === $selectedComic)?.languages ?? []);
	let languages = $derived(
		dedup(
			$comics
				.filter((c) => c.kind === 'page' && c.albumPath === albumPath)
				.flatMap((c) => c.languages)
		)
	);
	let selectedLanguage = $derived(
		preferredLanguage(readingPosition?.albumLanguages?.[albumPath], languages, browserLanguages)
	);
	let currentDocument = $derived(
		selectedLanguage === 'org' ? undefined : documentTargets.get(selectedLanguage)
	);
	let documentDirty = $derived(
		!!currentDocument && pendingChanges > 0 && !!activeFolder?.store.workspace.has(currentDocument)
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
			<li role="none" class="toolbar-group">
				<button
					type="button"
					class="toolbar-button"
					aria-label="Locate"
					title="Locate Page (L)"
					aria-keyshortcuts="l"
					disabled={!$selectedComic}
					onclick={locatePage}><ToolbarIcon name="crosshairs" /></button
				>
			</li>
			<li role="none" class="toolbar-group">
				<div role="group" aria-label="Page navigation">
					<button
						type="button"
						class="toolbar-button"
						aria-label="Previous Page"
						title="Previous Page (Pg Up)"
						aria-keyshortcuts="PageUp"
						disabled={!$selectedComic || albumPages.indexOf($selectedComic) <= 0}
						onclick={() => navigatePage(-1)}><ToolbarIcon name="caret-left" /></button
					>
					<button
						type="button"
						class="toolbar-button"
						aria-label="Next Page"
						title="Next Page (Pg Dn)"
						aria-keyshortcuts="PageDown"
						disabled={!$selectedComic ||
							albumPages.indexOf($selectedComic) + (pageMode === '2P' ? 2 : 1) >= albumPages.length}
						onclick={() => navigatePage(1)}><ToolbarIcon name="caret-right" /></button
					>
				</div>
			</li>
			<li role="none" class="toolbar-group">
				<div role="group" aria-label="Page layout">
					{#each [{ value: '1P', icon: 'file', label: 'Single Page' }, { value: '2P', icon: 'book-open', label: 'Side by Side' }] as mode}
						<button
							type="button"
							class="toolbar-button"
							aria-label={mode.label}
							title={`${mode.label} (${mode.value === '1P' ? '1 / S' : '2 / D'})`}
							aria-keyshortcuts={mode.value === '1P' ? '1 s' : '2 d'}
							aria-pressed={pageMode === mode.value}
							onclick={() => selectPageMode(mode.value)}
							><ToolbarIcon name={mode.icon as 'file' | 'book-open'} /></button
						>
					{/each}
				</div>
			</li>

			<HeaderNavMenu href={resolve('/')} text={selectedZoom.toUpperCase()}>
				<TileGroup selected={selectedZoom} on:select={(event) => selectZoom(event.detail)}>
					{#each zoomLevels as { id, label }}
						<RadioTile value={id}>{label}</RadioTile>
					{/each}
				</TileGroup>
			</HeaderNavMenu>

			<LanguageMenu
				selected={selectedLanguage || 'org'}
				{languages}
				{unsavedLanguages}
				onselect={selectLanguage}
			/>

			<li role="none" class="toolbar-group">
				<button
					type="button"
					class="toolbar-button"
					aria-label="Show Translations"
					title="Show Translations (B)"
					aria-pressed={showBubbles}
					aria-keyshortcuts="b"
					onclick={() => (showBubbles = !showBubbles)}><ToolbarIcon name="comments" /></button
				>
			</li>
			<li role="none" class="toolbar-group">
				<div role="group" aria-label="Reader mode">
					<button
						type="button"
						class="toolbar-button"
						aria-label="Reading Mode"
						title="Reading Mode (R)"
						aria-keyshortcuts="r"
						aria-pressed={selectedEdit === 'no'}
						onclick={() => (selectedEdit = 'no')}><ToolbarIcon name="eye" /></button
					>
					<button
						type="button"
						class="toolbar-button"
						aria-label="Edit Mode"
						title="Edit Mode (E)"
						aria-keyshortcuts="e"
						aria-pressed={selectedEdit === 'yes'}
						onclick={() => (selectedEdit = 'yes')}><ToolbarIcon name="file-pen" /></button
					>
				</div>
			</li>
			{#if editable}
				<li role="none" class="toolbar-group">
					<div role="group" aria-label="Text tools">
						<button
							type="button"
							class="toolbar-button scan-button"
							aria-label="Scan Full Page"
							title="Scan Full Page"
							disabled={!$selectedComic || loadingPages || scanning}
							aria-busy={scanning}
							onclick={requestScan}
						>
							<ToolbarIcon name="camera" />
							{#if $selectedComic && pageLanguages.length === 0}<span>Scan</span>{/if}
						</button>
						<button
							type="button"
							class="toolbar-button"
							aria-label="Cleanup Text"
							title="Cleanup Text (C)"><ToolbarIcon name="spell-check" /></button
						>
						<button
							type="button"
							class="toolbar-button"
							aria-label="Translate"
							title="Translate (T)"><ToolbarIcon name="globe" /></button
						>
					</div>
				</li>
				<li role="none" class="toolbar-group">
					<div role="group" aria-label="Drawing tool">
						<button
							type="button"
							class="toolbar-button"
							aria-label="Draw Boxes"
							title="Draw Boxes"
							aria-pressed={selectedShape === BblShapeType.box}
							onclick={() => (selectedShape = BblShapeType.box)}
							><ToolbarIcon name="square" /></button
						>
						<button
							type="button"
							class="toolbar-button"
							aria-label="Draw Polygons"
							title="Draw Polygons"
							aria-pressed={selectedShape === BblShapeType.poly}
							onclick={() => (selectedShape = BblShapeType.poly)}
							><ToolbarIcon name="star" /></button
						>
					</div>
				</li>
				<li role="none" class="toolbar-group">
					<div role="group" aria-label="Document changes">
						<button
							type="button"
							class="toolbar-button"
							aria-label="Save Changes"
							title={currentDocument ? `Save changes to ${currentDocument}` : 'Save Changes'}
							disabled={!documentDirty || changesBusy || scanning || loadingPages}
							onclick={saveChanges}><ToolbarIcon name="save" /></button
						>
						<button
							type="button"
							class="toolbar-button"
							aria-label="Discard Changes"
							title={currentDocument ? `Discard changes to ${currentDocument}` : 'Discard Changes'}
							disabled={!documentDirty || changesBusy || scanning || loadingPages}
							onclick={() => {
								discardFolder = activeFolder;
								discardDocument = currentDocument ?? '';
								discardOpen = true;
							}}><ToolbarIcon name="recycle" /></button
						>
					</div>
				</li>
				<li role="none" class="toolbar-group">
					<button
						type="button"
						class="toolbar-button"
						aria-label="OCR Settings"
						title="OCR Settings"
						onclick={() => {
							scanAfterSettings = false;
							ocrSettingsOpen = true;
						}}><ToolbarIcon name="settings" /></button
					>
				</li>
			{/if}
		</HeaderNav>
	</Header>

	<SideNav bind:isOpen={isSideNavOpen} resizable resizeHandleLabel="Resize sidebar">
		<SidebarPanes>
			{#snippet tree()}
				<div class="tree" class:no-sources={noSources}>
					<div class="tree-scroll">
						{#if !noSources}
							<ComicsTree
								bind:this={comicsTree}
								{selectedLanguage}
								onarchive={openArchive}
								{folders}
								selectedComic={$selectedComic}
								bind:expandedIds
								onselect={selectComic}
								ondisconnect={requestDisconnect}
							/>
						{/if}
						{#if restoringDirectory}
							<p>Restoring directory...</p>
						{:else}
							{#each savedDirectories.filter((saved) => !folders.some((folder) => folder.id === saved.id)) as saved}
								<Button on:click={() => reopenDirectory(saved)}
									>Reopen {saved.directory.name}</Button
								>
							{/each}
							{#if noSources}<p class="source-empty">Add a comics source</p>{/if}
						{/if}
					</div>
					{#if noSources}
						<span class="add-folder-tip" id="add-folder-tip" role="tooltip"
							>Click me to add comics</span
						>
					{/if}
					<button
						class="add-folder"
						aria-label="Add folder"
						aria-describedby={noSources ? 'add-folder-tip' : undefined}
						title="Add folder"
						onclick={selectDirectory}
						disabled={restoringDirectory}>+</button
					>
				</div>
			{/snippet}
			{#snippet pages()}
				<AlbumPages
					bind:this={albumPageList}
					{noSources}
					pages={$selectedComic ? albumPages : []}
					selectedComic={$selectedComic}
					onselect={selectComic}
				/>
			{/snippet}
		</SidebarPanes>
		{#if directoryError}<p role="alert">{directoryError}</p>{/if}
		{#if persistenceError}<p role="status">{persistenceError}</p>{/if}
	</SideNav>

	<OcrSettings
		externallyConfigured={!!externalVisionKey}
		bind:open={ocrSettingsOpen}
		bind:apiKey={ocrKey}
		onsaved={() => {
			if (scanAfterSettings) {
				scanAfterSettings = false;
				void scanPage();
			}
		}}
	/>

	<Modal
		bind:open={overwriteOcrOpen}
		modalHeading="Overwrite OCR and MRG overlays?"
		primaryButtonText="Overwrite and scan"
		secondaryButtonText="Cancel"
		size="xs"
		shouldSubmitOnEnter={false}
		on:submit={confirmOcrOverwrite}
		on:click:button--secondary={() => (overwriteOcrOpen = false)}
	>
		<p>
			“{overwriteOcrComic?.displayName}” already has scan overlays. Scanning again will replace its
			OCR and MRG text and shapes.
		</p>
	</Modal>

	<Modal
		bind:open={disconnectOpen}
		modalHeading="Remove folder?"
		primaryButtonText="Yes"
		secondaryButtonText="No"
		size="xs"
		shouldSubmitOnEnter={false}
		on:submit={confirmDisconnect}
		on:click:button--secondary={() => (disconnectOpen = false)}
	>
		<p>Do you really want to remove “{disconnectFolder?.directory.name}” from your folders?</p>
	</Modal>

	<Modal
		bind:open={discardOpen}
		modalHeading="Discard Changes?"
		primaryButtonText="Discard Changes"
		secondaryButtonText="Cancel"
		danger
		size="xs"
		shouldSubmitOnEnter={false}
		on:submit={discardChanges}
		on:click:button--secondary={() => (discardOpen = false)}
	>
		<p>
			Discard all unsaved changes in “{discardDocument}”? This includes all edited pages stored in
			this document. Its browser backup will be removed and its original content reloaded. This
			cannot be undone.
		</p>
	</Modal>

	<Content
		style={fullscreen ? 'padding: 0; margin: 0; min-height: 0' : 'padding: 0'}
		class={displayedPages.length === 0 ? 'fullsize empty-reader' : 'fullsize'}
	>
		{#if !fullscreen}
			{#if backupError || changesError}<p role="alert">{changesError || backupError}</p>{/if}
			{#if changesMessage}<p role="status">{changesMessage}</p>{/if}
			{#if scanError || scanMessage}
				<div class="scan-feedback">
					{#if scanError}<p role="alert">{scanError}</p>{/if}
					{#if scanMessage}<p role="status">{scanMessage}</p>{/if}
					<button
						type="button"
						class="toolbar-button"
						aria-label="Dismiss scan notification"
						title="Dismiss scan notification"
						onclick={dismissScanFeedback}>×</button
					>
				</div>
			{/if}
		{/if}
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
						{showBubbles}
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
		{:else if noSources}
			<div class="reader-empty source-empty">Add a comics source</div>
		{:else}
			<div class="reader-empty source-empty">Select a comic from the left</div>
		{/if}

		{#if !fullscreen}
			<ContextMenu on:open={setupMenu}>
				{#if menuTargetBubble}
					{#if menuTargetBubble.shape.type === BblShapeType.poly}
						{#if menuTargetPointIndex != null && menuTargetBubble.shape.vs.length > 3}
							<ContextMenuOption
								kind="danger"
								labelText="Delete point"
								on:click={handlePointDelete}
							/>
							<ContextMenuDivider />
						{/if}
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
	.toolbar-group {
		display: flex;
		align-items: center;
		padding: 0 0.5rem;
	}
	.toolbar-group > div {
		display: flex;
		border: 1px solid #c6c6c6;
		border-radius: 0.25rem;
		overflow: hidden;
	}
	.toolbar-button {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: #525252;
		cursor: pointer;
		border-radius: 0.125rem;
	}
	.scan-feedback {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		position: absolute;
		top: 0.5rem;
		left: 1rem;
		z-index: 1;
		max-width: calc(100% - 2rem);
		padding: 0.5rem 1rem;
		background: white;
		box-shadow: 0 2px 6px #0003;
	}
	.scan-button {
		display: flex;
		width: auto;
		min-width: 2.25rem;
		gap: 0.5rem;
		padding: 0 0.5rem;
	}
	.toolbar-button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.toolbar-group > div .toolbar-button + .toolbar-button {
		border-left: 1px solid #c6c6c6;
	}
	.toolbar-button:hover {
		background: #e8e8e8;
		color: #161616;
	}
	.toolbar-button[aria-pressed='true'] {
		background: #e0e0e0;
		color: #161616;
		box-shadow: inset 0 -2px #0f62fe;
	}
	.toolbar-button:focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: -3px;
	}

	.reader-shell :global(.bx--side-nav__resize-handle::after) {
		background-color: #c6c6c6;
		transition: none;
	}
	.reader-shell :global(.bx--side-nav__resize-handle:hover::after),
	.reader-shell :global(.bx--side-nav__resize-handle:focus-visible::after),
	.reader-shell :global(.bx--side-nav--resizing .bx--side-nav__resize-handle::after) {
		background-color: #0f62fe;
	}
	.tree.no-sources,
	:global(main.empty-reader) {
		background: #f4f4f4;
	}
	.tree.no-sources .tree-scroll {
		display: grid;
		place-items: center;
	}
	.source-empty {
		margin: 0;
		padding: 1rem;
		color: #6f6f6f;
		font-size: 0.875rem;
		text-align: center;
	}
	.reader-empty {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
	}
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
		position: relative;
		min-height: 0;
		background: #fff;
	}
	.tree-scroll {
		height: 100%;
		padding-bottom: 4rem;
		overflow: auto;
		overscroll-behavior: contain;
	}
	.add-folder-tip {
		position: absolute;
		right: 4.5rem;
		bottom: 1.375rem;
		padding: 0.375rem 0.75rem;
		border-radius: 0.25rem;
		background: #262626;
		color: white;
		font-size: 0.875rem;
		line-height: 1.25rem;
		white-space: nowrap;
		box-shadow: 0 2px 6px #0003;
		pointer-events: none;
	}
	.add-folder-tip::after {
		content: '';
		position: absolute;
		top: 50%;
		right: -0.375rem;
		transform: translateY(-50%);
		border-top: 0.375rem solid transparent;
		border-bottom: 0.375rem solid transparent;
		border-left: 0.375rem solid #262626;
	}
	.add-folder {
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		width: 2.75rem;
		height: 2.75rem;
		border: 0;
		border-radius: 50%;
		background: #0f62fe;
		color: white;
		font-size: 1.75rem;
		line-height: 1;
		box-shadow: 0 2px 6px #0003;
		cursor: pointer;
	}
	.add-folder:hover {
		background: #0353e9;
	}
	.add-folder:focus-visible {
		outline: 2px solid #0f62fe;
		outline-offset: 3px;
	}
	.add-folder:disabled {
		background: #c6c6c6;
		cursor: default;
	}
</style>
