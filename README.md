# Comix Sense

A local comic reader and speech-bubble overlay editor, built with Svelte 5 and SvelteKit.

## Terminology

- **Page**: an individual comic page, represented by an image and contained in an album.
- **Album**: an ordered group of pages forming a comic, stored in a folder or a supported archive.
- **Collection**: a group of albums stored together in a folder. Collections can also contain nested collections and loose pages.

Use **page**, **album**, and **collection** when describing the comic hierarchy in
the UI and documentation. Reserve **folder** and **directory** for filesystem details.

## Using the app

Open the app in Chrome or Edge, choose **Select directory...**, expand a folder in the sidebar, and select a page. Supported image extensions are BMP, GIF, JPG, JPEG, PNG, and WebP. The browser reads files from the selected directory; no server upload is involved.

Use **Left Arrow** and **Right Arrow** to read the previous and next page in the current album. In reading mode, clicking anywhere in the left or right half of the main pane does the same, including blank space and translation bubbles. Navigation stops at the first and last pages. Arrow keys retain their usual behavior in text fields, menus, and the sidebar tree.

The sidebar uses Font Awesome icons: an open book for albums (folders containing only pages), stacked layers for collections (folders grouping other folders, or empty folders), and a file for pages. A collection can also contain loose pages. Unsupported files do not affect this distinction.

Page labels can omit a collection + album prefix, ignoring case, whitespace and
symbols: in `Series/Volume/`, `Series — Volume_001.png` can display as `001`
(or `1` when the existing shared-prefix rule also removes common zeroes).
Album names that already include the collection name are handled too. Archive
labels also omit shared prefixes across the complete displayed path, including
repeated internal folders and filename prefixes. Non-shared path portions and
extensions remain visible. Actual filenames, paths and overlay associations
remain unchanged.

Choose **ORG** to see the original page, or select a language to show its speech-bubble overlays. For `page01.png`, new English overlays use `page01.en.bbl`. Existing full-image-name files such as `page01.png.en.bbl` are also supported. An overlay without a language suffix, `page01.bbl`, is also discovered. The filename determines the language option; the reader does not use JSON `lang` values to select it.

Enable **EDIT: YES** to edit text or drag a bubble's handles. For a new box, click two opposite corners. For a polygon, click its vertices and then click near the first vertex to close it. Escape cancels a drawing; Backspace removes the last vertex or cancels a box. Right-click bubble text to convert its shape or delete it. The zoom menu supports fit, width, and percentage scales.

Edits to language overlays and new OCR/MRG overlays are backed up in this browser
after a short pause (750 ms). Backups are serialized `.bbl` documents in IndexedDB,
matched to the original directory handle and document path. Reopening a collection
prefers its browser copies, using the same `.bbl` parser and rendering pipeline.
The last few edits can be lost if the browser closes before a backup completes;
clearing site data removes browser backups. Backup failures are shown in the reader.

**Save Changes** saves the `.bbl` document supplying the selected page and language,
requesting write permission if needed. It writes back to the same file it was read
from, preserving its name, metadata, and other pages. If that document covers several
pages, their pending edits are saved together. Other documents—including other
languages' files—remain unsaved. **Discard Changes** asks for confirmation, then
removes only that document's browser backup and reloads its original content.
There are no Save All or Discard All actions.

Completely new overlays are always saved per page and per language, using the image
filename **without its extension** plus `.<lang_code>.bbl`, for example `01.OCR.bbl`.
For loose images, the new document is saved beside its image.
Unsaved scan overlays disappear when discarded. Removing a top-level album or collection
from the sidebar keeps its browser backups for the next time it is added.

Pages with unsaved edits have outline icons and bold names in the comics tree;
their albums and all parent collections use the same indicators, up to the top-level item.
These markers apply across languages and
remain after browser backup or reload, until the edits are saved to disk or discarded.
Editing one page in a shared album document leaves its other pages unmarked.
The language dropdown uses bold text for the selected page's unsaved languages,
including OCR and MRG. Browser backup does not clear these indicators; disk saving
or confirmed discard clears the indicators belonging to that document.

For archive pages, new overlays go into a companion directory named after the
archive plus `.bbl`, created when needed: `book.cbz.bbl/pages/01.en.bbl` for a new
English overlay of `pages/01.png` in `book.cbz`. Internal subdirectories are preserved.
Existing `.bbl` documents read from inside an archive retain their document names
and scope in that companion directory: `album.en.bbl` becomes
`book.cbz.bbl/album.en.bbl`, and `pages/01.png.en.bbl` becomes
`book.cbz.bbl/pages/01.png.en.bbl`. Existing external documents keep their original paths.
Companion documents take precedence over documents inside the archive. Archives
themselves are not rewritten. Companion directories are hidden from the comics tree,
and embedded font resources still resolve within the archive.

Region-scanning context-menu actions and drag-and-drop import are still placeholders;
AI translation is available through the Translate button.

### Full-page OCR

In Edit Mode, click the camera button (**Scan Full Page**) to scan the selected
page using Google Cloud Vision `TEXT_DETECTION`. It also displays **Scan** when
that page has no language overlays. The request sends the original image directly
from the browser to Google; configure a user-provided API key with Cloud Vision
enabled. Google Cloud usage charges may apply.

On the first scan, enter the key in the masked field. **Remember on this browser**
opts into storing it in localStorage; otherwise it remains in memory for this
session. **OCR Settings** lets you change or **Forget key**. Browser storage is
not an encrypted vault, and clearing site data removes the remembered key.

Alternatively, set `GOOGLE_VISION_KEY` in the environment or a local `.env` file
before starting the dev server or building the app. It takes precedence over the
dialog key. OCR Settings then displays a message that the external key is in use
instead of the input, Remember and Forget controls. Restart the dev server or
rebuild after changing the variable. Because this is a static browser app, the
key is included in the client bundle; use an appropriately restricted browser API
key. Setting it only when serving an already-built app does not change that build.

Results appear as an editable **OCR** overlay, with one bounding box per word,
matching `tools/ocr.java` followed by `tools/ocr2bbl.java`. Each successful scan that recognizes text
also creates an **MRG** overlay using `tools/bubblemerge.java`'s grouping algorithm,
with line breaks and merged shapes. MRG has a solid object-group icon in the
language menu. Both overlays use the existing language/bubble model and can be
edited independently. Scans with text select MRG automatically.
Scans without text select OCR and leave any existing MRG overlay unchanged.

Rescanning a page with OCR or MRG asks for confirmation before sending a request.
A rescan with text replaces both overlays; other languages remain unchanged.
Results and edits are backed up in the browser and can be written to disk with
**Save Changes**. In side-by-side mode, only the selected page is scanned.

### AI text cleanup

In Edit Mode, choose a text overlay and click **Cleanup Text** (the spell-check
icon). Select **Current page** or **Entire album**, then **Clean text**. In
side-by-side mode, current page means the selected page. Album cleanup includes
only pages with the selected overlay. ORG has no bubble text to clean.

Open **OCR Settings → AI provider** to set the provider URL, model and API key.
The URL can be a base URL such as `https://api.openai.com/v1` or a complete
`/chat/completions` endpoint. Providers must support the OpenAI-compatible Chat
Completions request/response format with strict JSON Schema output
(`response_format: { type: "json_schema", json_schema: { strict: true, ... } }`)
and allow browser requests through CORS. Requests include a schema requiring the
original languages and string IDs/text, with no extra fields.
Response items can be in any order; text is matched to bubbles by ID. The app
also validates returned IDs and empty fields before replacing text. Missing items
leave their bubbles unchanged and produce a warning; other valid items are applied. Providers
or models without schema support fail without retrying in a weaker output mode.
The key is optional for local providers without authentication. URL and model are
remembered; the key stays in memory unless **Remember on this browser** is checked.
**Forget key** clears the active and stored AI key independently of Google Vision.
Remembered keys are stored without encryption in browser localStorage.

Cleanup sends only bubble text in a JSON object with `sourceLanguage`, identical
`targetLanguage`, and ordered `items` containing `id` and `text`. IDs use
`/pages/{albumPageIndex}/bubbles/{bubbleIndex}`, with zero-based indexes. OCR/MRG
language labels use the `.bbl` page/document's `lang` when available, then
unambiguous bubble language metadata, otherwise `und`.
The hard-coded prompt conservatively corrects OCR, spelling and punctuation while
preserving meaning, voice, names, capitalization and line breaks. No images are
sent, so uncertain OCR readings are left unchanged.
Both prompts support `{sourceLanguage}` and `{targetLanguage}` placeholders,
replaced with the request's actual language codes before sending the system
message. Cleanup explicitly names its source language; translation names both.
Bubble text is never interpolated.

The entire selected scope is sent in one request for context. Choose page cleanup
if the album exceeds your model's context/output limits. Only text is replaced;
geometry and metadata stay unchanged. Invalid JSON, changed IDs/languages,
truncated responses, or edits/disconnection during the request abort replacement.
Requests can be cancelled and time out after three minutes. Cleanup results enter
the same browser backup and Save/Discard workflow as manual edits. Use **Save Changes**
to write each affected document to disk. This feature uses a small HTTP adapter
without LangChain or an SDK.

To extract the same cleanup JSON from a `.bbl` file without calling a provider:

```sh
jbang tools/bubbletext.java album.en.bbl > cleanup.json
```

The script prints only `sourceLanguage`, `targetLanguage`, and the ordered `items`
with bubble paths and text, including empty strings. Page indexes start at zero
within the supplied file. Conventional language suffixes take precedence over
the document's `lang`; OCR/MRG use bubble language metadata, or `und` when ambiguous.
Without a language suffix, the document's `lang` is used, falling back to bubble
language metadata. The input file is never modified.

### AI page translation

In Edit Mode, select the source text overlay and click **Translate**. Choose a
language from the dropdown, then click **OK**. Both language dropdowns show
Flagpack icons and English language names with codes, such as **Dutch (NL)** and
**French (FR)**. Names come from `Intl.DisplayNames`; unknown codes and the
ORG/OCR/MRG overlays keep their code labels. The reader toolbar keeps a compact
code with the full language label in its tooltip. Translation applies only to the
selected page, including in side-by-side mode. ORG has no extracted text; scan it
first or choose an existing text overlay.

If the selected page already has that target language, confirm **Overwrite and
translate** before any request is sent. Cancelling leaves the existing translation
unchanged. The same AI provider settings and strict JSON Schema are used as for
cleanup; the request sets `targetLanguage` to the chosen code and uses a translation
prompt. Returned texts are matched by ID, regardless of order. Source text, shapes,
and styles are copied into an independent target overlay; source edits remain
unchanged. The dialog names the resolved source language (for example, Dutch (NL))
or shows **(Unknown)** when no language can be resolved. The same resolved code is
used in the AI request. The target overlay is selected when translation finishes on the current
page and participates in browser backup, Save Changes and Discard Changes.

Missing response items produce a warning. Existing target bubbles at omitted
indexes are kept where available; otherwise source text is retained for those
bubbles. An entirely empty result leaves the target unchanged. Concurrent edits
to either source or target, removal of the folder, or invalid responses prevent
replacement. Translating after navigating away still updates the original page
without changing the current page's selected language.

### Bubble file format (`.bbl`)

**Design decision: one translation language per `.bbl` file, always.** A document
may cover one page or several pages of the same language. Different languages must
use separate `.bbl` files; mixing languages in one document is intentionally unsupported.
Keep this constraint in future proposals, and flag requests that suggest mixing languages.
Per-bubble OCR locale metadata does not create additional translation languages.

Each `.bbl` file is JSON with a `pages` array containing page objects with ordered `bubbles` arrays. The reader preserves file/page metadata and matches album-index pages by their `filename`; legacy single-page sidecars may omit it. The shape-based format is illustrated below:

```json
{
	"lang": "en",
	"pages": [
		{
			"bubbles": [
				{
					"text": "Hello!",
					"lang": "en",
					"shape": {
						"type": "box",
						"vs": [
							{ "x": 80, "y": 80 },
							{ "x": 300, "y": 180 }
						]
					}
				}
			]
		}
	]
}
```

The fields in the shape-based format are listed below. Paths are relative to the file root, except the explicitly named bubble and vertex fields. Not every bubble contains every field.

| Field               | JSON type        | Meaning / current reader behavior                                                                                                                                                          |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lang`              | string           | File-level language metadata, such as `nl`, `en`, or `es`; not used by the reader.                                                                                                         |
| `pages`             | array of objects | Page records matched by album-relative `filename`; legacy unnamed sidecars use the first unnamed record.                                                                                   |
| `pages[].bubbles`   | array of objects | Ordered text regions for a page.                                                                                                                                                           |
| Bubble `text`       | string           | Region text, including dialogue, narration, signs, or sound effects. May be empty or contain escaped newlines (`\n`). The reader displays this text; its current CSS collapses whitespace. |
| Bubble `lang`       | string           | Optional per-region language metadata; may differ from the file language (including OCR language guesses or `und` for undetermined). Not used by the reader.                               |
| Bubble `shape`      | object           | Geometry required by the current renderer.                                                                                                                                                 |
| Bubble `shape.type` | string           | `box` for a rectangle or `poly` for a polygon.                                                                                                                                             |
| Bubble `shape.vs`   | array of objects | Two opposite corners for a box; an ordered list of vertices for a polygon, closed by the renderer.                                                                                         |
| Vertex `x`, `y`     | number           | Coordinates in the original image's pixel coordinate system, with the origin at the top left, x increasing rightward and y downward.                                                       |

The current `Bubble` type additionally supports an optional `style` object mapping CSS property names to string values, for example `"style": { "fill": "white", "opacity": "0.8" }`. It is applied to the SVG rectangle or polygon, not the text element. No `style` fields were found in the inspected collection. This example and the field inventory describe the available files and implementation; the format has no version field or formal schema in this project.

### Typography and album indexes

These optional extensions are implemented for directory and archive albums.
Existing sidecars require no migration or format-version field.

#### Font defaults and overrides

An optional `font` object is allowed at the file root, on each page, and on
each bubble. Resolve each property independently in this order:

**Reader defaults → file font → page font → bubble font**

When a page has its own sidecar, applicable album font defaults are inherited
before the sidecar's file, page, and bubble settings (see album precedence below).

| Property        | Meaning / accepted values                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `family`        | Nonempty ordered array of font family names and optional generic fallbacks, such as `["Komika Text Tight", "sans-serif"]`.                                                               |
| `size`          | Positive number in the original image's pixel coordinate system. Scales with the artwork when zooming; independent of DPI metadata. This is nominal font size, not visible glyph height. |
| `style`         | `"normal"`, `"italic"`, or `"oblique"`.                                                                                                                                                  |
| `weight`        | Integer from 1 to 1000; typically 400 (normal) or 700 (bold).                                                                                                                            |
| `lineHeight`    | Positive multiplier of font size; 1 means 100% line height.                                                                                                                              |
| `letterSpacing` | Additional letter spacing in image coordinates; may be negative. Reader default: 0.                                                                                                      |

Every property is optional. Omitted properties inherit; an empty `font` object
changes nothing. Use an explicit value such as `"style": "normal"` to cancel
inherited italics. `null` is not a reset value and is invalid. A `family` array
replaces the inherited array as a whole. Removing an override restores
inheritance. Keep explicit overrides separate from resolved values so that
changing a default updates inheriting bubbles.

Files without font settings retain the existing rendering, including the
current 18pt font size and 100% line height. `font` affects text only; the
existing bubble `style` object continues to affect its SVG background.
Page and bubble geometry and ordering are unaffected. Formatting individual
words, automatic text fitting, and named styles are outside this initial design.

#### Font resources

An optional root-level `fontFaces` array declares font files shared by all
pages. Each entry has `family` and `src`, with optional `style` and `weight`
descriptors (defaulting to `normal` and 400). These describe the supplied face;
the `font` objects select which family, style, and weight to use. Declare
separate entries for separate regular, italic, and bold files.

`src` accepts either an album-relative resource path or an absolute HTTPS URL
pointing directly to a font file. Local resources can live in the selected
album directory or inside its archive. Relative font paths use the same album
root as page filenames, even when the index is outside the album. WOFF2 is the
preferred format, with WOFF and TTF/OTF support useful for existing collections.

The reader can register fonts through the browser's `FontFace` API, without
system installation. A declared resource takes precedence over an installed
font with the same family name; internal aliases isolate fonts from different
albums. Load required faces before final text layout and reuse loads within the album.
Each load has a five-second deadline, including resource reading and decoding.
On failure or timeout, omit the declared family (including any installed font
of the same name), continue with the next fallback, and warn once in the console.
A final `sans-serif` fallback is appended when a family list is specified.
Registrations are removed on album/root disposal; late loads cannot register.
No third-party fonts are bundled. The original CC0 test font is a local fixture.

Remote font hosts must permit cross-origin loading (CORS). A font provider's
embedding permission does not necessarily include a stable URL for direct
loading: a download page or webfont-kit ZIP is not a font resource URL. Remote
fonts need a connection unless explicitly cached for offline use; packaged
fonts work offline. Distribution and embedding must follow the font's licence.
For example, [Komika Text](https://www.fontsquirrel.com/fonts/komika-text)
offers a webfont kit. Browser loading is documented in
[FontFace](https://developer.mozilla.org/en-US/docs/Web/API/FontFace) and
[@font-face](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face).

#### Album indexes and page filenames

An album index holds multiple page records in a single `.bbl`. Inside an album,
`album.bbl` or `album.<language>.bbl` describes the containing album. An adjacent
index matches an album directory or archive by name, for example:

```text
mycomics.cbr
mycomics.cbr.en.bbl
othercomics/
othercomics.fr.bbl
```

Each page in an album index requires a `filename`, including its actual image
extension. It is a path **relative to the matched album root**, not to the
index's location. For an archive, that means its internal root. Use `/` as the
portable separator and keep paths within the album. Match by path, not by the
order of records in `pages`. Duplicate normalized page filenames retain the first
record in array order and produce a console warning; later duplicates are ignored.
An index may cover only some images; normal image discovery still finds the
other pages. An index can therefore move between the album root and its adjacent
location without rewriting page or font resource paths.

An album index may also contain only shared defaults, with `pages` omitted or
empty. For example, adding this `album.bbl` to an album with existing page
sidecars supplies typography for all of them without editing those files:

```json
{
	"font": {
		"family": ["Komika Text Tight", "sans-serif"],
		"size": 35,
		"style": "italic"
	}
}
```

It can also declare `fontFaces`, making the font resources available to page
sidecars. Shared defaults apply even when there is no corresponding record in
the index's `pages` array. An unsuffixed album index supplies shared defaults
across languages; a language-specific index can override them for that language.
The index does not create a translation option merely by supplying font defaults.

`filename` remains optional for an existing single-page sidecar, whose image
is matched by the sidecar name. Filename language suffixes continue to select
the language; JSON `lang` remains metadata.

For adjacent album indexes and individual page sidecars, match names as follows
(after separating any language suffix and the final `.bbl`):

1. Prefer an exact filename match, including the image or archive extension.
2. Otherwise accept a basename match only when it identifies one eligible target.
3. Ignore ambiguous shorthand documents and log candidate targets and the recovery
   action to the console. Establish the target independently of language selection.

When both exact-name and shorthand documents target the same page/album and
language, the exact-name document wins regardless of discovery order.

| Sidecar / index       | Target                                                       |
| --------------------- | ------------------------------------------------------------ |
| `mycomics.cbr.en.bbl` | Exactly `mycomics.cbr`.                                      |
| `mycomics.en.bbl`     | The album named `mycomics`, if the basename match is unique. |
| `comic-page.jpg.bbl`  | Exactly `comic-page.jpg`.                                    |
| `comic-page.bbl`      | The image with basename `comic-page`, if unique.             |

A directory's full name already lacks an archive extension. If both
`mycomics/` and `mycomics.cbr` exist, `mycomics.en.bbl` matches the directory
exactly; use `mycomics.cbr.en.bbl` for the archive. If `comic-page.jpg` and
`comic-page.webp` coexist, `comic-page.bbl` is ambiguous: use
`comic-page.jpg.bbl` and/or `comic-page.webp.bbl` instead. Existing exact-name
documents keep those names when saved. New overlays use the image stem plus
`.<language>.bbl`, as described above; image stems should be unique within an album.

When several documents describe the same image and language, precedence is:

**Individual page sidecar → adjacent album index → internal album index**

Select the bubble array from the highest-priority document that supplies it
for that page; do not merge bubble arrays. An explicitly empty array is still
a supplied definition. Font defaults are inherited separately, property by
property, from lower to higher priority:

**Reader defaults → internal album file/page fonts → adjacent album file/page
fonts → sidecar file/page fonts → selected bubble font**

At each album location, apply unsuffixed shared defaults before defaults for
the selected language. Page-level fonts apply only to the matching filename.
Inherited `fontFaces` remain available; a higher-priority declaration of the
same family, style, and weight replaces the lower-priority face. Sidecars need
only specify their exceptions. Adding album typography therefore does not
replace existing page text or geometry, and external corrections can still be
made without repacking an archive.

#### Combined example

This could be `mycomics.cbr.en.bbl` next to `mycomics.cbr`, or
`album.en.bbl` inside the archive. Both refer to the same internal paths:

```json
{
	"lang": "en",
	"fontFaces": [
		{
			"family": "Komika Text Tight",
			"src": "fonts/komika-tight-italic.woff2",
			"style": "italic",
			"weight": 400
		}
	],
	"font": {
		"family": ["Komika Text Tight", "sans-serif"],
		"size": 35,
		"style": "italic",
		"weight": 400,
		"lineHeight": 1
	},
	"pages": [
		{
			"filename": "pages/01.jpg",
			"font": { "size": 32 },
			"bubbles": [
				{
					"text": "Hello!",
					"shape": {
						"type": "box",
						"vs": [
							{ "x": 80, "y": 80 },
							{ "x": 300, "y": 180 }
						]
					}
				},
				{
					"text": "HELP!",
					"font": { "size": 44 },
					"shape": {
						"type": "box",
						"vs": [
							{ "x": 350, "y": 80 },
							{ "x": 550, "y": 180 }
						]
					}
				}
			]
		},
		{
			"filename": "pages/02.webp",
			"bubbles": []
		}
	]
}
```

The first bubble inherits the file's family, italic style, and weight, with
the page's size of 32. The second overrides size to 44. The second page inherits
the file's size of 35. Paths and coordinates above are illustrative.

Document/page metadata survives directory/archive loading, caches, rendering,
and session editing. Explicit bubble overrides remain separate from inherited
values; newly drawn bubbles inherit page defaults. Typography scales in the same
SVG coordinate system as the image. The translation helper preserves typography,
resource declarations, filenames and geometry byte-for-byte. This repository has
no bubble-merging helper; any future merge implementation must respect different
font overrides and resolved defaults.

#### Recovery and diagnostics

Recoverable metadata and resource problems never open prompts, popups, or badges.
Warnings are deduplicated for the collection/album lifetime and include the
document, page/field or source, reason, and deterministic recovery action:

| Problem                                          | Recovery                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Ambiguous shorthand image/archive name           | Ignore the document; warn with candidate filenames.                                      |
| Duplicate normalized index page filename         | Keep the first record, including an explicitly empty bubble array.                       |
| Invalid, absolute or escaping page filename      | Skip the page record; preserve other pages and file defaults.                            |
| Invalid optional font property, including `null` | Ignore that property; keep valid properties and inherit.                                 |
| Invalid `fontFaces` entry                        | Skip that entry; keep valid declarations.                                                |
| Failed/timed-out font resource                   | Skip the declared family and use the next fallback; cache failure for the session.       |
| Malformed index JSON                             | Ignore the index; continue discovering images and usable sidecars.                       |
| Invalid page/bubble metadata                     | Skip invalid records/bubbles; invalid bubble-array values inherit lower-priority arrays. |

Paths use `/`, are case-sensitive and normalized to NFC; harmless `./` segments
are removed. Backslashes, empty segments, absolute paths, drive prefixes and
`..` segments are rejected. The nearest directory with an internal or adjacent
index defines the album root for its descendant images; a nested indexed folder
starts a separate album. Pages absent from indexes remain discoverable. Reserved
`album[.<language>].bbl` filenames always denote internal indexes.

At each album location, shared defaults precede selected-language defaults.
Defaults-only page records do not erase lower-priority bubbles. Defaults-only
indexes do not add language choices; sidecars retain filename-based discovery.
Malformed legacy sidecar JSON retains the existing overlay error behavior.
Unreadable images and corrupt archives retain their existing fatal error handling.

For a requested family, style matches precede other styles, then the nearest
numeric weight wins; declaration order breaks ties. The browser may synthesize
missing styles. Family matching is case-insensitive; generic fallback names use their CSS meanings. HTTPS requests
use browser CORS and are aborted at timeout/disposal; no persistent offline cache
is implemented. Packaged resources use the existing archive reader and limits.
Saving/exporting, automatic text fitting, rich text and typography editing controls
remain deferred.

## Developing

Use Node.js 22.17 or newer in the 22.x series, or Node.js 24 or newer:

```bash
npm ci
npm run dev
```

## Validation

```bash
npm run check
npx playwright install chromium
npm test
npm run build
```

Browser tests use deterministic local files through a simulated directory picker, exercising the actual reader and editor. On Windows they use installed Microsoft Edge by default; set `PLAYWRIGHT_CHANNEL=chromium` to use Playwright's Chromium instead. On Linux, CI installs Chromium with `npx playwright install --with-deps chromium`.

## Building

```bash
npm run build
npm run preview
```

The static site is generated in `build/` and served under `/comix-sense/` in production. The GitHub Pages workflow runs type checks and browser tests before building and deploying.

To run the same browser tests against a running preview or another checkout, set `TEST_BASE_URL` to its full URL, including the trailing slash (for example, `http://localhost:4173/comix-sense/`).

## Local comic archives

Archives found in selected directories (`.cbz`, `.zip`, `.cbr`, case insensitive)
are readable albums. Click or press Enter to open one; Right Arrow expands it
without selecting a page. Indexing starts only on opening, with loading/error
text in the tree. Images in internal subdirectories form one album, ordered
naturally by their full normalized paths (`2.png` before `10.png`). Existing
page modes, zoom, overlays, editing and reading history also work in archives.
Page sidecars such as `page.png.en.bbl` (or unambiguous `page.en.bbl`) are
discovered beside images; internal/adjacent album indexes can cover nested paths.
Saved companion sidecars (described above) take precedence over embedded sidecars.
Nested archives and standalone/drag-and-drop import are not implemented.

ZIP/CBZ supports stored and deflated entries using **@zip.js/zip.js 2.24.0**,
`BlobReader`, and browser compression streams. The ZIP is not copied into a
single ArrayBuffer or extracted in advance. CBR uses **libarchive.js 2.0.2**'s
libarchive 3.7.2 WASM decoder. Format signatures and decoder validation determine
the format; suffixes only control discovery. RAR4, RAR5 and a solid RAR5 fixture
are tested. This does not establish support for every RAR variant (particularly
newer RAR7 compression or all solid RAR4 variants).

Archives and extracted content stay in the browser. Decompression runs in a
single disposable worker across all roots, with a 15-second deadline per
operation. Codec assets and their notices are copied from locked dependencies
at install/dev/build time and served from `/comix-sense/codecs/` in production;
no third-party runtime codec fetch or Node browser polyfill is involved. The
existing Carbon stylesheet may request external fonts; these requests contain
no archive payload. Dependency notices are in `third-party/archive-codecs/`.

Fixed initial limits (`src/lib/archives/ArchiveReader.ts`, `src/lib/ImageUrls.ts`):

| Resource                                           |       Limit |
| -------------------------------------------------- | ----------: |
| ZIP input                                          |     512 MiB |
| RAR input                                          |      32 MiB |
| Entries (including ignored metadata/directories)   |      10,000 |
| Declared individual output; actual ZIP output sink |      32 MiB |
| Total declared RAR output per archive              |     128 MiB |
| RAR5 dictionary                                    |      64 MiB |
| Extracted Blob cache, shared across roots          |      64 MiB |
| Archive Blob data held by renderer URLs            |     128 MiB |
| Active decompression                               | 1 operation |

The session Blob cache evicts individual entries, keeping least-recently-used
order within three eviction tiers: thumbnails first, then inactive albums,
then other unprotected entries in active albums. Displayed and incoming spreads
are protected until their image loads are abandoned or their display URLs are
released. If protected entries fill the 64 MiB budget, additional results can
still be displayed without being cached; protection never increases that budget.
Releasing a display URL does not remove an otherwise cached Blob.

Queued reader images and overlays take priority over sidebar thumbnails. A
reader request for an entry already queued as a thumbnail promotes the shared
extraction rather than creating a second job. Running decompression is allowed
to finish; priority does not interrupt a decoder already working. Cancelling
or disconnecting an archive removes its queued jobs and terminates active work.
There is no next-spread prefetch. File fingerprint invalidation and warm WASM
readers remain deferred; decoder workers still have one-operation lifetimes.

The cache and renderer pools together retain at most 192 MiB of encoded output
(excluding decoder working memory, metadata, text/session edits, and browser
image decoding/GPU allocations). Cache eviction drops Blob references; no idle
RAR heap/worker is kept. Offscreen archive thumbnails release their URLs, as do
abandoned page loads and disconnected roots. Incoming and outgoing spreads can
briefly coexist. Very large images can exhaust the renderer budget and fail
with an explicit error. These limits are conservative product limits, not a
sandbox-level cap on a browser process.

Encrypted archives, multipart sets, unsafe paths, normalized duplicate names,
RAR5 unknown output sizes and newer compression versions are unsupported.
Directories, links, `__MACOSX` and `.DS_Store` are ignored as page content. Only
supported raster image types are rendered; archive HTML/SVG is not rendered.
Reported corruption, unsupported compression, empty albums, malformed overlay JSON
and invalid raster data report errors without removing adjacent comics. The known
stored-RAR CRC detection gap below remains unresolved.

### RAR measurements and limits

On local Windows Edge, the bundled real decoder was tested with redistributable
libarchive fixtures (see `tests/fixtures/archives/README.md`). Each test lists,
reads last → first → last, compares actual output, and terminates every worker.
Representative warm worker operations, including WASM instantiation:

| Fixture             |   Input | Selected output | WASM heap | Warm operation |
| ------------------- | ------: | --------------: | --------: | -------------: |
| RAR4                |   336 B |            20 B |    16 MiB |       19–35 ms |
| RAR5 compressed     |   436 B |         1,200 B |    16 MiB |       19–35 ms |
| Solid RAR5, 7 files | 1,050 B |   last: 4,096 B |    16 MiB |       19–35 ms |

Cold startup varied (roughly 50–400 ms). These tiny fixtures are compatibility
checks, not a large-archive benchmark. Measurements vary by machine and run;
`tests/archives.spec.ts` prints current times and heap sizes.

RAR is **not streaming or constant-time random access** here. It copies the
bounded compressed input into worker memory and then into WASM. The adapter
scans the whole archive for each uncached operation, including files after the
selected one, to validate metadata and encryption. In the solid fixture, the
last-file read skips 21,680 declared bytes from other files; listing traverses
all 25,776 declared bytes. Libarchive's solid-RAR skip implementation decodes
preceding data to rebuild its dictionary. First/last timings are similar here
because both operations traverse all headers and solid data; they do not show
random access. Backward navigation can repeat that cost after cache eviction.
See [libarchive's RAR5 reader](https://github.com/libarchive/libarchive/blob/v3.7.2/libarchive/archive_read_support_format_rar5.c).

The public libarchive.js single-file wrapper was evaluated first. Its entry
loop opens readers without consistently closing them between calls and its
object-based index is inappropriate for untrusted normalized names. The app
therefore calls the pinned decoder's exported functions in a small worker
adapter, validates flat metadata, frees its reader/input, and terminates the
worker after every operation. Only the requested output Blob survives into the
bounded cache; earlier extracted outputs are not accumulated inside a long-lived
WASM heap. This trades startup/scan time for deterministic lifetime cleanup.
**Known corruption issue, deferred:** changing a byte in a stored RAR4 entry can
return the changed payload without reporting its CRC mismatch. The exported
`get_filedata` helper calls the native read once and exposes neither the actual
read length nor a final CRC status. The test named "known libarchive stored-RAR
CRC detection gap (deferred)" is an **expected failure** so this limitation stays
visible and a future fix will require updating the test. Image decoding or JSON
validation may reject damaged content, but this is not archive-integrity verification.

The browser-only in-memory API of node-unrar-js 2.0.2 was also evaluated in the
same disposable worker. It passed the fixture/backward-reading checks and rejected
the changed stored payload. This release retains libarchive.js; investigating
its corruption handling and reconsidering that alternative are follow-up work.
node-unrar-js and its filesystem API are not included in the application.

Libarchive's `get_filedata` helper allocates output internally from the declared
size and does not expose a streaming byte limiter or the actual read length.
Metadata limits, dictionary checks, the conservative input limit and terminating
the worker after 15 seconds reduce exposure but **do not enforce a hard bound
on decoder heap growth or prove arbitrary malformed RAR output sizes**. ZIP
also validates actual decompressed size and the app counts bytes at its output
sink; forged small metadata is covered by a real decompression test. No claim
of unrestricted large-archive support is made.

To validate the production worker and WASM paths after building:

```powershell
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173
# In a second terminal:
$env:TEST_BASE_URL='http://127.0.0.1:4173/comix-sense/'
npx playwright test tests/archives.spec.ts --workers=1
```

The development suite additionally tests real-decoder cache eviction,
deduplication, cancellation, and worker termination through the reader adapter.
Production tests exercise the same emitted worker/WASM through archive selection,
restoration, editing, independent roots and disconnect-during-indexing behavior.
