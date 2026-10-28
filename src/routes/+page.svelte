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
		Dropdown,
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
	import ComicPage from '#lib/ComicPage.svelte';
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
	import FontSettings from '#lib/FontSettings.svelte';
	import type { FontScope } from '#lib/bbl/metadata.js';
	import LanguageMenu from '#lib/LanguageMenu.svelte';
	import OcrSettings from '#lib/OcrSettings.svelte';
	import Notification from '#lib/Notification.svelte';
	import { flag, languageLabel, translationLanguages } from '#lib/languageFlags.js';
	import {
		prepareCleanup,
		requestCleanup,
		requestTranslation,
		resolveSourceLanguage,
		normalizeAiSettings,
		type AiSettings
	} from '#lib/textCleanup.js';
	import { scanImage } from '#lib/ocr.js';
	import { isRenderLanguage, prepareRender, requestRender } from '#lib/render.js';
	import { releaseImageUrl } from '#lib/ImageUrls.js';
	import { dedup } from '#lib/types/funcs.js';

	let ai = $state<AiSettings>(normalizeAiSettings(undefined));
	let rendering = $state(false);
	let renderElapsed = $state(0);
	$effect(() => {
		if (!rendering) return;
		const started = performance.now();
		renderElapsed = 0;
		const timer = window.setInterval(() => {
			renderElapsed = Math.floor((performance.now() - started) / 1000);
		}, 1000);
		return () => window.clearInterval(timer);
	});
	let renderMessage = $state('');
	let renderError = $state('');
	let renderController: AbortController | undefined;
	let renderedRevision = $state(0);

	async function renderPage() {
		const comic = $selectedComic;
		const folder = activeFolder;
		const language = selectedLanguage;
		if (!canRender || !comic || !folder) return;
		if (!ai.render.model.trim()) {
			settingsTab = 'ai';
			ocrSettingsOpen = true;
			return;
		}
		const settings = normalizeAiSettings(ai);
		const controller = new AbortController();
		renderController = controller;
		rendering = true;
		renderError = '';
		renderMessage = `Rendering ${comic.displayName} in ${language.toUpperCase()}…`;
		const timeout = window.setTimeout(() => controller.abort('timeout'), 600000);
		let url: string | undefined;
		try {
			if ((await folder.directory.requestPermission({ mode: 'readwrite' })) !== 'granted')
				throw new Error('Write access to the page directory is required.');
			const document = await prepareRender(comic, language);
			url = await comic.getImageUrl();
			const original = new Image();
			original.src = url;
			await original.decode();
			// Normalize supported reader formats to an API-supported PNG without resizing.
			const canvas = window.document.createElement('canvas');
			canvas.width = original.naturalWidth;
			canvas.height = original.naturalHeight;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Could not read the original page image.');
			context.drawImage(original, 0, 0);
			const image = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob(
					(blob) =>
						blob ? resolve(blob) : reject(new Error('Could not encode the original page.')),
					'image/png'
				)
			);
			controller.signal.throwIfAborted();
			const result = await requestRender(
				document,
				image,
				{ width: canvas.width, height: canvas.height },
				settings,
				controller.signal
			);
			controller.signal.throwIfAborted();
			const decoded = await createImageBitmap(result);
			decoded.close();
			controller.signal.throwIfAborted();
			if (!folders.includes(folder))
				throw new Error('The page directory was disconnected during rendering.');
			const path = await folder.store.saveRendered(comic, language, result);
			renderedRevision++;
			comics.update((values) => [...values]);
			if ($selectedComic === comic && selectedLanguage === language) selectedEdit = 'no';
			renderMessage = `Saved rendered page to “${path}”.`;
		} catch (error) {
			renderMessage = '';
			renderError = controller.signal.aborted
				? controller.signal.reason === 'timeout'
					? 'Render timed out. No image was saved.'
					: 'Render cancelled. No image was saved.'
				: 'Render failed: ' + (error instanceof Error ? error.message : String(error));
		} finally {
			if (url) releaseImageUrl(url);
			window.clearTimeout(timeout);
			rendering = false;
			renderController = undefined;
		}
	}
	let settingsTab = $state('ocr');
	let cleanupOpen = $state(false);
	let cleanupScope = $state('page');
	let translationOpen = $state(false);
	let overwriteTranslationOpen = $state(false);
	let translationTarget = $state('fr');
	let aiOperation = $state<'cleanup' | 'translation'>('cleanup');
	let targetLanguages = $derived(
		translationLanguages.filter(({ id }) => id !== selectedLanguage.toLowerCase())
	);
	let translationSourceLabel = $derived.by(() => {
		const page = displayedPages.find(
			(page) => page.comic === $selectedComic && page.language === selectedLanguage
		);
		if (!page) return '(Unknown)';
		const source = resolveSourceLanguage(selectedLanguage, [
			{
				bubbles: page.bubbles,
				declaredLanguage: page.comic.sourceLanguage(selectedLanguage)
			}
		]);
		return source === 'und' ? '(Unknown)' : languageLabel(source);
	});
	let cleaning = $state(false);
	let cleanupMessage = $state('');
	let cleanupWarning = $state('');
	let cleanupError = $state('');
	let cleanupController: AbortController | undefined;

	function openCleanup() {
		if (
			!$selectedComic ||
			cleaning ||
			rendering ||
			scanning ||
			loadingPages ||
			!editable ||
			selectedLanguage === 'org'
		)
			return;
		cleanupError = '';
		cleanupWarning = '';
		cleanupMessage = '';
		cleanupOpen = true;
	}

	function openTranslation() {
		if (
			!$selectedComic ||
			cleaning ||
			rendering ||
			scanning ||
			loadingPages ||
			!editable ||
			selectedLanguage === 'org'
		)
			return;
		if (!targetLanguages.some(({ id }) => id === translationTarget))
			translationTarget =
				targetLanguages.find(({ id }) => id === 'en')?.id ?? targetLanguages[0].id;
		translationOpen = true;
	}

	function submitTranslation(confirmed = false) {
		const comic = $selectedComic;
		if (!comic || !targetLanguages.some(({ id }) => id === translationTarget)) return;
		const existing = comic.languages.find(
			(lang) => lang.toLowerCase() === translationTarget.toLowerCase()
		);
		translationOpen = false;
		if (existing && !confirmed) {
			overwriteTranslationOpen = true;
			return;
		}
		overwriteTranslationOpen = false;
		void cleanText(existing ?? translationTarget);
	}

	async function cleanText(targetLanguage?: string) {
		const comic = $selectedComic;
		const language = selectedLanguage;
		const translating = targetLanguage !== undefined;
		const action = translating ? 'Translation' : 'Cleanup';
		if (!comic || cleaning || rendering || scanning || !editable || language === 'org') return;
		if (!ai.url.trim() || !ai[translating ? 'translation' : 'cleanup'].model.trim()) {
			cleanupOpen = false;
			translationOpen = false;
			settingsTab = 'ai';
			ocrSettingsOpen = true;
			return;
		}
		const pages = [...albumPages];
		const selected = !translating && cleanupScope === 'album' ? pages : [comic];
		const outputLanguage = targetLanguage ?? language;
		aiOperation = translating ? 'translation' : 'cleanup';
		cleanupOpen = false;
		cleaning = true;
		cleanupError = '';
		cleanupWarning = '';
		cleanupMessage = translating ? 'Translating page…' : 'Cleaning text…';
		const controller = new AbortController();
		cleanupController = controller;
		const timeout = window.setTimeout(() => controller.abort('timeout'), 180000);
		try {
			const job = await prepareCleanup(pages, selected, language, outputLanguage);
			if (!job.document.items.some((item) => item.text.trim()))
				throw new Error('No bubble text in this overlay.');
			controller.signal.throwIfAborted();
			const result = await (translating ? requestTranslation : requestCleanup)(
				job.document,
				{ ...ai },
				controller.signal
			);
			controller.signal.throwIfAborted();
			const { changed, missingIds } = await job.apply(
				result,
				(page) => folders.some((folder) => folder.comics.includes(page)),
				controller.signal
			);
			const refreshed = await Promise.all(
				displayedPages.map(async (page) =>
					page.language === outputLanguage && selected.includes(page.comic)
						? { ...page, bubbles: await page.comic.getBubbles(outputLanguage) }
						: page
				)
			);
			displayedPages = displayedPages.map((page) => {
				const updated = refreshed.find(
					(candidate) => candidate.comic === page.comic && candidate.language === page.language
				);
				return updated ? { ...page, bubbles: updated.bubbles } : page;
			});
			if (translating) {
				comics.update((values) => [...values]);
				if ($selectedComic === comic && comic.languages.includes(outputLanguage)) {
					selectLanguage(outputLanguage);
					showBubbles = true;
				}
			}
			cleanupMessage = translating
				? `${job.document.items.length - missingIds.length} bubbles translated to ${outputLanguage.toUpperCase()}.${job.document.items.length > missingIds.length ? ' Use Save Changes to write the translation to disk.' : ''}`
				: `${changed} bubble text${changed === 1 ? '' : 's'} updated.${changed ? ' Use Save Changes to write them to disk.' : ''}`;
			if (missingIds.length)
				cleanupWarning = `AI omitted ${missingIds.length} bubble${missingIds.length === 1 ? '' : 's'}. ${translating ? 'Existing target bubbles were kept where available; otherwise source text was kept. An empty result leaves the target unchanged.' : 'Their text was left unchanged.'}`;
		} catch (error) {
			cleanupMessage = '';
			cleanupError = controller.signal.aborted
				? controller.signal.reason === 'timeout'
					? `${action} timed out. No text was replaced.`
					: `${action} cancelled. No text was replaced.`
				: `${action} failed: ` + (error instanceof Error ? error.message : String(error));
		} finally {
			window.clearTimeout(timeout);
			cleaning = false;
			cleanupController = undefined;
		}
	}

	let ocrKey = $state('');
	const externalVisionKey = import.meta.env.GOOGLE_VISION_KEY;
	let effectiveOcrKey = $derived(externalVisionKey || ocrKey);
	let ocrSettingsOpen = $state(false);
	let overwriteOcrOpen = $state(false);
	let scanButton = $state<HTMLButtonElement>();
	let scanOpen = $state(false);
	let scanScope = $state('page');
	let pendingScanPages = $state.raw<Comic[]>([]);
	let overwriteOcrCount = $derived(
		pendingScanPages.filter((comic) => comic.languages.some((lang) => lang.toLowerCase() === 'ocr'))
			.length
	);
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
		if (!$selectedComic || scanning || cleaning || rendering || !editable || loadingPages) return;
		scanOpen = true;
	}

	function submitScan() {
		if (!$selectedComic) return;
		pendingScanPages = scanScope === 'album' ? [...albumPages] : [$selectedComic];
		scanOpen = false;
		scanButton?.focus();
		if (!effectiveOcrKey) {
			scanAfterSettings = true;
			settingsTab = 'ocr';
			ocrSettingsOpen = true;
		} else void scanPages();
	}

	function confirmOcrOverwrite() {
		overwriteOcrOpen = false;
		void scanPages(true);
	}

	async function scanPages(confirmed = false) {
		if (!pendingScanPages.length || scanning || cleaning || rendering || !editable || loadingPages)
			return;
		const pages = [...pendingScanPages];
		const key = effectiveOcrKey;
		if (overwriteOcrCount && !confirmed) {
			overwriteOcrOpen = true;
			return;
		}
		scanning = true;
		scanError = '';
		scanMessage = 'Preparing scan…';
		const controller = new AbortController();
		scanController = controller;
		let completed = 0;
		try {
			for (const comic of pages) {
				controller.signal.throwIfAborted();
				if (!folders.some((folder) => folder.comics.includes(comic)))
					throw new Error('The page directory was disconnected during scanning.');
				scanMessage = `Scanning ${comic.displayName} (${completed + 1}/${pages.length})…`;
				const ocrLanguage = comic.languages.find((lang) => lang.toLowerCase() === 'ocr') ?? 'OCR';
				const release = comic.protectImage();
				let url: string | undefined;
				try {
					const previous = comic.languages.includes(ocrLanguage)
						? await comic.getBubbles(ocrLanguage)
						: [];
					const baseline = JSON.stringify(previous);
					url = await comic.getImageUrl();
					const response = await fetch(url, { signal: controller.signal });
					if (!response.ok) throw new Error('Could not read the page image.');
					const result = await scanImage(await response.blob(), key, controller.signal);
					if (
						controller.signal.aborted ||
						!folders.some((folder) => folder.comics.includes(comic))
					) {
						throw new Error('The scan was cancelled or the page directory was disconnected.');
					}
					if (JSON.stringify(previous) !== baseline)
						throw new Error('A scan overlay was edited during scanning. Scan again to replace it.');
					await comic.editBubbles(ocrLanguage, result.bubbles);
					comic.setSourceLanguage(ocrLanguage, result.lang);
					comic.setBubbles(ocrLanguage, result.bubbles);
					comic.languages = [...new Set([...comic.languages, ocrLanguage])];
					comics.update((values) => [...values]);
					if ($selectedComic === comic) {
						selectLanguage(ocrLanguage);
						showBubbles = true;
						// Refresh OCR if it is already displayed.
						displayedPages = displayedPages.map((page) =>
							page.comic === comic && page.language === ocrLanguage
								? { ...page, bubbles: result.bubbles }
								: page
						);
					}
					scanMessage = result.bubbles.some((bubble) => bubble.text.trim())
						? `${comic.displayName}: ${result.bubbles.length} speech bubbles recognized. Browser backup scheduled.`
						: `${comic.displayName}: No text recognized.`;
					completed++;
				} finally {
					if (url) releaseImageUrl(url);
					release();
				}
			}
			if (pages.length > 1)
				scanMessage = `${completed} pages scanned. Use Save Changes to write the OCR overlays to disk.`;
		} catch (error) {
			if (!controller.signal.aborted)
				scanError =
					'Scan failed: ' +
					(error instanceof Error ? error.message : String(error)) +
					(completed
						? ` ${completed} completed page(s) kept. Use Save Changes to write them to disk.`
						: '');
			scanMessage = '';
		} finally {
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
	let fontSettingsOpen = $state(false);
	let fontScope = $state<FontScope>('page');
	let fontPagePath = $state('');
	let fontPage = $derived(
		pageViews.find((page) => page?.pagePath() === fontPagePath) ?? pageViews[0]
	);
	let fontPanelTarget = $derived(fontPage?.fontTarget(fontScope));
	function toggleFontSettings() {
		if (!fontSettingsOpen && fontPage?.fontTarget('bubble').bubble) fontScope = 'bubble';
		fontSettingsOpen = !fontSettingsOpen;
	}
	function closeFontSettings() {
		fontSettingsOpen = false;
		readerUi
			?.querySelector<HTMLButtonElement>('[data-font-settings-toggle]')
			?.focus({ preventScroll: true });
	}
	const pageImages = new PageImages();
	let displayedPages = $state.raw<
		{
			comic: Comic;
			image: PageImage;
			imageComic: Comic;
			editing: boolean;
			bubbles: Bubble[];
			language: string;
			overlayError?: string;
		}[]
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
		renderController?.abort();
		scanController?.abort();
		cleanupController?.abort();
		pageImages.retain([]);
		for (const folder of folders) folder.store.dispose();
	});

	$effect(() => {
		const requested = visiblePages;
		void renderedRevision;
		const language = selectedLanguage;
		const editing = editingMode;
		const imageComics = requested.map((comic) =>
			editing ? comic : comic.imageForLanguage(language)
		);
		let cancelled = false;
		loadingPages = requested.length > 0;
		pageLoadError = '';
		pageImages.retain([
			...imageComics,
			...untrack(() => displayedPages).map((page) => page.imageComic)
		]);
		void Promise.all(
			requested.map(async (comic, index) => {
				const imageComic = imageComics[index];
				let overlayError: string | undefined;
				const [image, bubbles] = await Promise.all([
					pageImages.load(imageComic),
					editing || imageComic === comic
						? comic.getBubbles(language).catch((error) => {
								if (editing) throw error;
								overlayError = String(error);
								return [];
							})
						: Promise.resolve([])
				]);
				return { comic, image, imageComic, editing, bubbles, language, overlayError };
			})
		)
			.then(async (pages) => {
				if (cancelled) return;
				displayedPages = pages;
				pageLoadError = pages
					.map((page) => page.overlayError)
					.filter(Boolean)
					.join('\n');
				loadingPages = false;
				// Let the outgoing SVGs leave the DOM before revoking their image URLs.
				await tick();
				if (!cancelled) pageImages.retain(imageComics);
			})
			.catch((error) => {
				if (!cancelled) {
					pageLoadError = String(error);
					loadingPages = false;
					pageImages.retain(displayedPages.map((page) => page.imageComic));
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
	let pendingAlbums = $state.raw<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
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
	let discardAll = $state(false);
	let discardDocuments = $state<string[]>([]);
	let discardOpen = $state(false);

	$effect(() => {
		if (!cleaning && cleanupMessage && !cleanupError && !cleanupWarning) {
			const timer = window.setTimeout(() => (cleanupMessage = ''), 6000);
			return () => window.clearTimeout(timer);
		}
	});

	$effect(() => {
		if (!changesBusy && changesMessage) {
			const timer = window.setTimeout(() => (changesMessage = ''), 6000);
			return () => window.clearTimeout(timer);
		}
	});

	$effect(() => {
		const workspace = activeFolder?.store.workspace;
		pendingChanges = 0;
		pendingAlbums = new Map();
		pendingLanguages = new Map();
		backupError = '';
		const pending = workspace?.pending.subscribe((value) => (pendingChanges = value));
		const error = workspace?.error.subscribe((value) => (backupError = value));
		const languages = workspace?.pendingLanguages.subscribe((value) => (pendingLanguages = value));
		const albums = workspace?.pendingAlbums.subscribe((value) => (pendingAlbums = value));
		return () => {
			pending?.();
			error?.();
			languages?.();
			albums?.();
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

	async function saveChanges(all = false) {
		const folder = activeFolder;
		const document = all ? albumPath || folder?.directory.name : currentDocument;
		const documents = all ? albumDocuments : currentDocuments;
		if (!folder || !document || changesBusy || scanning || cleaning || rendering) return;
		changesBusy = true;
		changesMessage = changesError = '';
		try {
			let completed = 0;
			try {
				for (const path of documents) {
					await folder.store.workspace.save(path);
					completed++;
				}
			} finally {
				if (completed) {
					await folder.store.workspace.flush();
					await reloadFolder(folder);
				}
			}
			changesMessage = all
				? `Saved all changes in album “${document}”.`
				: `Saved changes to “${document}”.`;
		} catch (error) {
			changesError = 'Could not save changes: ' + String(error);
		} finally {
			changesBusy = false;
		}
	}

	async function discardChanges() {
		const folder = discardFolder;
		const document = discardDocument;
		const documents = discardDocuments;
		discardOpen = false;
		discardFolder = undefined;
		if (!folder || !document || changesBusy) return;
		changesBusy = true;
		changesMessage = changesError = '';
		try {
			let completed = 0;
			try {
				for (const path of documents) {
					await folder.store.workspace.discard(path);
					completed++;
				}
			} finally {
				if (completed) {
					await folder.store.workspace.flush();
					await reloadFolder(folder);
				}
			}
			changesMessage = discardAll
				? `All changes in album “${document}” discarded.`
				: `Changes to “${document}” discarded.`;
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
			scanOpen ||
			cleanupOpen ||
			translationOpen ||
			overwriteTranslationOpen ||
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
			(key === 'l' || key === 'r' || key === 'e' || key === 't') &&
			!(
				event.target instanceof Element &&
				event.target.closest(
					'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
				)
			) &&
			!disconnectOpen &&
			!ocrSettingsOpen &&
			!scanOpen &&
			!cleanupOpen &&
			!translationOpen &&
			!overwriteTranslationOpen &&
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
				else if (key === 't') {
					if (editable) toggleFontSettings();
				} else selectedEdit = key === 'e' ? 'yes' : 'no';
			}
			return;
		}
		if (
			disconnectOpen ||
			ocrSettingsOpen ||
			scanOpen ||
			cleanupOpen ||
			translationOpen ||
			overwriteTranslationOpen ||
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
	let menuTargetView: ReaderPage | undefined;
	let menuTargetPart = $state('mask');
	let menuTargetPointIndex = $state<number>();

	function setupMenu(evt: CustomEvent<Element>) {
		menuTargetBubble = undefined;
		menuTargetPointIndex = undefined;
		if (!editable || !showBubbles) return;
		for (const view of pageViews) {
			const target = view?.getBubble(evt.detail);
			if (target) {
				menuTargetView = view;
				view.activateBubble(target.bubble);
				menuTargetPart = target.part;
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
	let editingMode = $derived(selectedEdit === 'yes' && !fullscreen);
	let editable = $derived(editingMode && !changesBusy && !discardOpen);
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
	let availableLanguages = $derived(
		new Set(languages.filter((language) => $selectedComic?.hasTranslation(language)))
	);
	let selectedLanguage = $derived(
		preferredLanguage(readingPosition?.albumLanguages?.[albumPath], languages, browserLanguages)
	);
	let pageDocument = $derived(
		selectedLanguage === 'org' ? undefined : documentTargets.get(selectedLanguage)
	);
	let currentDocuments = $derived.by(() => {
		const workspace = activeFolder?.store.workspace;
		const path = $selectedComic?.path;
		const albumDocuments =
			path === undefined
				? []
				: [...pendingAlbums]
						.filter(([album]) =>
							path.startsWith(album.endsWith('/') || album === '' ? album : album + '/')
						)
						.flatMap(([, paths]) => [...paths]);
		const pageDocuments =
			path === undefined ? [] : (workspace?.pageDocuments(path, selectedLanguage) ?? []);
		return [
			...new Set([...(pageDocument ? [pageDocument] : []), ...pageDocuments, ...albumDocuments])
		].filter((document) => workspace?.has(document));
	});
	let albumDocuments = $derived.by(() => {
		// Subscribe even when edits move between documents without changing their count.
		void pendingLanguages;
		void pendingAlbums;
		if (!pendingChanges || !$selectedComic) return [];
		return (
			activeFolder?.store.workspace.albumDocuments(
				albumPath,
				albumPages.map((page) => page.path)
			) ?? []
		);
	});

	let currentDocument = $derived(currentDocuments.join(', ') || pageDocument);
	let documentDirty = $derived(pendingChanges > 0 && currentDocuments.length > 0);
	let canRender = $derived(
		!!$selectedComic &&
			editable &&
			!loadingPages &&
			!scanning &&
			!cleaning &&
			!rendering &&
			isRenderLanguage(selectedLanguage) &&
			pageLanguages.includes(selectedLanguage) &&
			!!activeFolder?.store.canRender($selectedComic)
	);
</script>

<svelte:window onkeydown={handleNavigationKey} onclick={handleNavigationClick} />

{#if fontSettingsOpen && editable && fontPanelTarget && fontPage}
	<FontSettings
		{...fontPanelTarget}
		busy={loadingPages}
		bind:scope={fontScope}
		onchange={(font) => fontPage.setFont(fontScope, font)}
		onfaceschange={(faces) => fontPage.setFontFaces(fontScope, faces)}
		ongeometry={(action) => fontPage.geometry(action)}
		onappearance={(changes) => fontPage.setAppearance(changes)}
		onclose={closeFontSettings}
	/>
{/if}

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
				{availableLanguages}
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
					<button
						type="button"
						class="toolbar-button"
						aria-label="Text &amp; Layout Settings"
						title="Text &amp; Layout Settings (T)"
						aria-keyshortcuts="t"
						aria-expanded={fontSettingsOpen}
						data-font-settings-toggle
						onclick={toggleFontSettings}><ToolbarIcon name="font" /></button
					>
				</li>
				<li role="none" class="toolbar-group">
					<div role="group" aria-label="Text tools">
						<button
							type="button"
							class="toolbar-button scan-button"
							bind:this={scanButton}
							aria-label="Scan Full Page"
							title="Scan Full Page"
							disabled={!$selectedComic || loadingPages || scanning || cleaning || rendering}
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
							title="Cleanup Text"
							disabled={!$selectedComic ||
								loadingPages ||
								scanning ||
								cleaning ||
								rendering ||
								selectedLanguage === 'org'}
							aria-busy={cleaning}
							onclick={openCleanup}><ToolbarIcon name="spell-check" /></button
						>
						<button
							type="button"
							class="toolbar-button"
							aria-label="Translate"
							title="Translate"
							disabled={!$selectedComic ||
								loadingPages ||
								scanning ||
								cleaning ||
								rendering ||
								selectedLanguage === 'org'}
							onclick={openTranslation}><ToolbarIcon name="globe" /></button
						>
						<button
							type="button"
							class="toolbar-button"
							aria-label="Render Page"
							title="Render Page"
							disabled={!canRender}
							aria-busy={rendering}
							onclick={() => void renderPage()}><ToolbarIcon name="paint-roller" /></button
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
							disabled={!documentDirty ||
								changesBusy ||
								scanning ||
								cleaning ||
								rendering ||
								loadingPages}
							onclick={() => void saveChanges()}><ToolbarIcon name="save" /></button
						>
						<button
							type="button"
							class="toolbar-button"
							aria-label="Discard Changes"
							title={currentDocument ? `Discard changes to ${currentDocument}` : 'Discard Changes'}
							disabled={!documentDirty ||
								changesBusy ||
								scanning ||
								cleaning ||
								rendering ||
								loadingPages}
							onclick={() => {
								discardAll = false;
								discardFolder = activeFolder;
								discardDocument = currentDocument ?? '';
								discardDocuments = [...currentDocuments];
								discardOpen = true;
							}}><ToolbarIcon name="recycle" /></button
						>
						<button
							type="button"
							class="toolbar-button album-action"
							aria-label="Save All"
							title="Save all changes in the current album"
							disabled={!albumDocuments.length ||
								changesBusy ||
								scanning ||
								cleaning ||
								rendering ||
								loadingPages}
							onclick={() => void saveChanges(true)}
							><ToolbarIcon name="save" /><span>All</span></button
						>
						<button
							type="button"
							class="toolbar-button album-action"
							aria-label="Discard All"
							title="Discard all changes in the current album"
							disabled={!albumDocuments.length ||
								changesBusy ||
								scanning ||
								cleaning ||
								rendering ||
								loadingPages}
							onclick={() => {
								discardAll = true;
								discardFolder = activeFolder;
								discardDocument = albumPath || activeFolder?.directory.name || '';
								discardDocuments = [...albumDocuments];
								discardOpen = true;
							}}><ToolbarIcon name="recycle" /><span>All</span></button
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
							settingsTab = 'ocr';
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
	</SideNav>

	<OcrSettings
		bind:ai
		bind:tab={settingsTab}
		externallyConfigured={!!externalVisionKey}
		bind:open={ocrSettingsOpen}
		bind:apiKey={ocrKey}
		onsaved={() => {
			if (scanAfterSettings && settingsTab === 'ocr') {
				scanAfterSettings = false;
				void scanPages();
			}
		}}
	/>

	<Modal
		bind:open={scanOpen}
		modalHeading="Scan comic text"
		primaryButtonText="Scan"
		secondaryButtonText="Cancel"
		size="sm"
		shouldSubmitOnEnter={false}
		on:submit={submitScan}
		on:click:button--secondary={() => (scanOpen = false)}
	>
		<p>
			Send original page images to Google Cloud Vision to create editable OCR overlays. Use Save
			Changes to write them to disk.
		</p>
		<label for="scan-scope">Scope</label>
		<select id="scan-scope" bind:value={scanScope}>
			<option value="page">Current page</option>
			<option value="album">Entire album ({albumPages.length} pages)</option>
		</select>
	</Modal>

	<Modal
		bind:open={cleanupOpen}
		modalHeading="Clean up bubble text"
		primaryButtonText="Clean text"
		secondaryButtonText="Cancel"
		size="sm"
		shouldSubmitOnEnter={false}
		on:submit={() => void cleanText()}
		on:click:button--secondary={() => (cleanupOpen = false)}
	>
		<p>
			Send text from the {selectedLanguage} overlay to your AI provider and replace it with corrected
			text. Use Save Changes to write them to disk.
		</p>
		<label for="cleanup-scope">Scope</label>
		<select id="cleanup-scope" bind:value={cleanupScope}>
			<option value="page">Current page</option>
			<option value="album">Entire album ({albumPages.length} pages)</option>
		</select>
		<p>Album cleanup includes pages with this overlay; pages without it are skipped.</p>
		<button
			type="button"
			onclick={() => {
				cleanupOpen = false;
				settingsTab = 'ai';
				scanAfterSettings = false;
				ocrSettingsOpen = true;
			}}>Configure AI provider</button
		>
	</Modal>

	<Modal
		bind:open={translationOpen}
		modalHeading="Translate page"
		primaryButtonText="OK"
		secondaryButtonText="Cancel"
		primaryButtonDisabled={!translationTarget}
		size="sm"
		shouldSubmitOnEnter={false}
		on:submit={() => submitTranslation()}
		on:click:button--secondary={() => (translationOpen = false)}
	>
		<p>Translate the selected page's bubble text from {translationSourceLabel} into:</p>
		<Dropdown
			id="translation-language"
			labelText="Target language"
			label="Choose a language"
			items={targetLanguages}
			bind:selectedId={translationTarget}
		>
			<svelte:fragment slot="icon" let:item
				><img src={flag(item.id)} alt="" width="24" height="18" /></svelte:fragment
			>
		</Dropdown>
		<p>Text is sent to your configured AI provider. The source overlay stays unchanged.</p>
		<button
			type="button"
			onclick={() => {
				translationOpen = false;
				settingsTab = 'ai';
				scanAfterSettings = false;
				ocrSettingsOpen = true;
			}}>Configure AI provider</button
		>
	</Modal>

	<Modal
		bind:open={overwriteTranslationOpen}
		modalHeading="Overwrite translation?"
		primaryButtonText="Overwrite and translate"
		secondaryButtonText="Cancel"
		size="sm"
		shouldSubmitOnEnter={false}
		on:submit={() => submitTranslation(true)}
		on:click:button--secondary={() => (overwriteTranslationOpen = false)}
	>
		<p>
			The selected page already has a {translationTarget.toUpperCase()} translation. Replace its text
			and bubble shapes with a translation of the current overlay?
		</p>
	</Modal>

	<Modal
		bind:open={overwriteOcrOpen}
		modalHeading="Overwrite OCR overlay?"
		primaryButtonText="Overwrite and scan"
		secondaryButtonText="Cancel"
		size="xs"
		shouldSubmitOnEnter={false}
		on:submit={confirmOcrOverwrite}
		on:click:button--secondary={() => (overwriteOcrOpen = false)}
	>
		<p>
			{overwriteOcrCount} selected page(s) already have an OCR overlay. Scanning again will replace their
			OCR text and shapes.
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
		modalHeading={discardAll ? 'Discard All?' : 'Discard Changes?'}
		primaryButtonText={discardAll ? 'Discard All' : 'Discard Changes'}
		secondaryButtonText="Cancel"
		danger
		size="xs"
		shouldSubmitOnEnter={false}
		on:submit={discardChanges}
		on:click:button--secondary={() => (discardOpen = false)}
	>
		<p>
			Discard all unsaved changes in {discardAll ? 'album ' : ''}“{discardDocument}”?
			{#if discardAll}This affects every edited language in this album.{/if}
			This includes album font defaults and all edited pages stored in these documents. Their browser
			backups will be removed and their original content reloaded. This cannot be undone.
		</p>
	</Modal>

	<Content
		style={fullscreen ? 'padding: 0; margin: 0; min-height: 0' : 'padding: 0'}
		class={displayedPages.length === 0 ? 'fullsize empty-reader' : 'fullsize'}
	>
		{#if !fullscreen}
			<div class="notification-stack">
				{#if directoryError}
					<Notification
						label="Dismiss directory notification"
						ondismiss={() => (directoryError = '')}
					>
						<p role="alert">{directoryError}</p>
					</Notification>
				{/if}
				{#if persistenceError}
					<Notification
						label="Dismiss storage notification"
						ondismiss={() => (persistenceError = '')}
					>
						<p role="status">{persistenceError}</p>
					</Notification>
				{/if}
				{#if backupError}
					<Notification label="Dismiss backup notification" ondismiss={() => (backupError = '')}>
						<p role="alert">{backupError}</p>
					</Notification>
				{/if}
				{#if changesError || changesMessage}
					<Notification
						label="Dismiss changes notification"
						ondismiss={() => {
							changesError = '';
							changesMessage = '';
						}}
					>
						{#if changesError}<p role="alert">{changesError}</p>{/if}
						{#if changesMessage}<p role="status">{changesMessage}</p>{/if}
					</Notification>
				{/if}
				{#if cleanupError || cleanupMessage || cleanupWarning}
					<Notification
						label={aiOperation === 'translation'
							? 'Dismiss translation notification'
							: 'Dismiss cleanup notification'}
						ondismiss={() => {
							cleanupMessage = '';
							cleanupWarning = '';
							cleanupError = '';
						}}
					>
						{#if cleanupError}<p role="alert">{cleanupError}</p>{/if}
						{#if cleanupWarning}<p role="alert">{cleanupWarning}</p>{/if}
						{#if cleanupMessage}<p role="status">{cleanupMessage}</p>{/if}
						{#if cleaning}
							<button type="button" onclick={() => cleanupController?.abort()}
								>{aiOperation === 'translation' ? 'Cancel translation' : 'Cancel cleanup'}</button
							>
						{/if}
					</Notification>
				{/if}
				{#if renderError || renderMessage}
					<Notification
						label="Dismiss render notification"
						ondismiss={() => {
							renderMessage = '';
							renderError = '';
						}}
					>
						{#if renderError}<p role="alert">{renderError}</p>{/if}
						{#if renderMessage}<p role="status">{renderMessage}</p>{/if}
						{#if rendering}<p aria-label="Elapsed render time" aria-live="off">
								Elapsed: {renderElapsed}s
							</p>{/if}
						{#if rendering}<button type="button" onclick={() => renderController?.abort()}
								>Cancel render</button
							>{/if}
					</Notification>
				{/if}
				{#if scanError || scanMessage}
					<Notification label="Dismiss scan notification" ondismiss={dismissScanFeedback}>
						{#if scanError}<p role="alert">{scanError}</p>{/if}
						{#if scanMessage}<p role="status">{scanMessage}</p>{/if}
					</Notification>
				{/if}
				{#if pageLoadError}
					<Notification
						label="Dismiss page loading notification"
						ondismiss={() => (pageLoadError = '')}
					>
						<p role="alert">{pageLoadError}</p>
					</Notification>
				{/if}
			</div>
		{/if}
		{#if displayedPages.length}
			<Zoom level={selectedZoom} contentSize={spreadSize} centered={fullscreen}>
				{#each displayedPages as page, i (page.comic)}
					{#if page.imageComic === page.comic && !page.overlayError}
						<ReaderPage
							bind:this={pageViews[i]}
							comic={page.comic}
							image={page.image}
							loadedBubbles={page.bubbles}
							language={page.language}
							{showBubbles}
							editable={editable && page.editing}
							{selectedShape}
							onfontselect={() => (fontPagePath = page.comic.path)}
						/>
					{:else}
						<div data-page-path={page.comic.path}>
							<ComicPage img={page.image.url} width={page.image.width} height={page.image.height} />
						</div>
					{/if}
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
					<ContextMenuOption
						labelText="Bubble settings"
						on:click={() => {
							fontPagePath = menuTargetView?.pagePath() ?? '';
							fontScope = 'bubble';
							fontSettingsOpen = true;
						}}
					/>
					{#if menuTargetBubble.layout === undefined}
						<ContextMenuOption
							labelText="Separate text and mask"
							on:click={() => menuTargetView?.geometry('separate')}
						/>
					{/if}
					{#if menuTargetPart !== 'text'}
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
									labelText={languageLabel(lang)}
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
	.notification-stack {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		position: absolute;
		top: 0.5rem;
		left: 1rem;
		z-index: 1;
		max-width: calc(100% - 2rem);
		max-height: calc(100% - 1rem);
		overflow-y: auto;
	}
	.scan-button,
	.album-action {
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
