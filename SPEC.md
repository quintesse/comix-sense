# Comix Sense Product Specification

**Status:** Draft for discussion

**Purpose:** Define the intended product and its core requirements. `PLAN.md` records proposed improvements and acceptance checks; this document defines the product those improvements should support. These requirements describe intended capabilities, not necessarily features already implemented.

## Product Goals

Comix Sense is a viewer and editor for translated comics. Users can read original pages, switch between translations in any user-selected language, create translations with as much automation as possible, and freely edit the results afterward.

Original artwork and editable translation data remain separate during normal use. Users can distribute translations independently of the original album or export a complete album with translations included.

The project has not had a public release. Backward compatibility with existing formats, schemas, and APIs is not required.

## Web Architecture and Static Hosting

- The application is a web app that must be deployable as static files on a static host.
- Do not require an application backend, server-side rendering at runtime, custom server-side API, serverless function, or API proxy.
- Run album browsing, archive reading/writing, editing, rendering, export, and local persistence in the browser using browser-compatible libraries and APIs. Do not require a local companion server or native executable.
- External server-side APIs are allowed only when provided by third parties, such as Google Vision or Google Translation. Call these services directly from the browser using authentication and access methods supported by the provider.
- Choose integrations that work within browser access and authentication constraints; do not introduce a custom backend to accommodate an incompatible provider.
- Do not embed private service credentials in the published static assets. Provider configuration and user authorization must fit the static web app model.
- Access local files and folders through user-granted browser access or file selection, and save/export through browser-supported mechanisms.

## Albums and Collections

- An **album** is an ordered set of comic page images stored in a folder or archive.
- A **collection** is a folder containing albums, either as image folders or archive files. Collections may contain nested folders and a mixture of album storage types.
- Support image folders and comic archives, including CBR and ZIP/CBZ.
- Preserve page order and associate translation data with the correct images regardless of whether an album is opened from a folder or archive.
- Allow browsing collections, opening albums, navigating pages, and switching between the original and available target languages.

## Translation Creation and Editing

- Automate region detection, OCR, translation, original-lettering removal, and replacement-text layout wherever practical.
- Let users choose the target language; do not assume English or infer the original language solely from filenames.
- Allow full manual editing after automation, including recognized source text, translated text, region creation/deletion, splitting/merging, reading order, removal masks, text placement, and typography.
- Keep translations editable and saveable without modifying the original images.
- Preserve manual corrections when rerunning automation unless the user explicitly chooses to replace them.
- Support processing whole albums or collections, with progress reporting, resumable work, and review of uncertain results.

## Translation Storage and Distribution

### BBL documents

- Store editable translations in `.bbl` files alongside original image files for folder-based albums.
- For archived albums, support `.bbl` files alongside image entries inside the archive and separately distributed translation files alongside the album archive.
- Support both granular and bundled storage: a `.bbl` document can hold one page or multiple pages, always in a single translation language. Different languages must use separate `.bbl` files.
- Identify each translation's language and associated album/page images within the data. Association must not depend solely on incidental file enumeration order.
- Retain the data needed to reproduce and edit the translated presentation, including text, region geometry, layout, and references to any required supporting assets.
- Allow granular and bundled representations to express the same translation content without losing text, language associations, or editing information.

### Separate language packages

- Allow translations to be distributed without including the original album images.
- Allow each target language to be packaged and distributed independently.
- Discover and associate a translation package stored next to its album. For example, `comicX.fr.zip` could supply French translations for `comicX.cbr`.
- A package may contain multiple `.bbl` files or a bundled `.bbl` document, together with supporting assets needed for that translation. It must not require redistributing the original page images.
- Make available languages visible to the user and report missing or ambiguous album/page associations.

The example names illustrate the intended workflow; exact naming conventions, matching rules, and the `.bbl` schema remain design decisions.

## Album Export

### Default: originals with editable translations

- Export a CBR containing the original page images and all associated `.bbl` files, including translations originally loaded from external packages.
- Include supporting translation assets needed to render and edit the included translations.
- Preserve original image bytes and page order in this mode.
- Reopening the exported album in Comix Sense must expose its original pages and included languages as editable overlays.

### Rendered translation export

- Offer a separate export mode that burns a user-selected translation into the page images.
- Render the edited translation, including lettering removal and final text layout, so readers can view it without `.bbl` support.
- Preserve page order and leave the source album and its original images unchanged.
- Identify missing translations or unresolved rendering problems before export so the user can resolve them or explicitly choose how to handle them.

CBR exports must be valid RAR-based comic archives, not ZIP archives renamed with a `.cbr` extension. Archive creation must satisfy the browser-only, static-hosting requirements above. Validate browser-compatible RAR creation feasibility before selecting archive tooling; any unresolved limitation must be brought back for a product decision.

## Acceptance Scenarios

- [ ] Deploy the built app to a static host and use browsing, editing, saving, and both export modes without an application backend or local companion service.
- [ ] Verify that runtime API requests go only to configured third-party services and that published assets contain no private service credentials.
- [ ] Open an album from an image folder, CBR archive, and ZIP/CBZ archive, with the expected page order.
- [ ] Browse a collection containing image-folder albums, archived albums, and nested folders.
- [ ] Create a translation in a user-selected language, manually revise its text and layout, save it, and reopen it with those revisions intact.
- [ ] Rerun automation without silently discarding reviewed manual edits.
- [ ] Load equivalent translations from individual page `.bbl` files and a bundled `.bbl` document.
- [ ] Associate all pages and languages correctly when an album package contains multiple pages and separate `.bbl` files for each language.
- [ ] Open an album with a neighboring language ZIP and read its translation without changing the album archive.
- [ ] Distribute one language's translation package without original page images or other languages' translations.
- [ ] Export a default CBR, verify original image bytes are unchanged, and reopen all included translations for editing.
- [ ] Export a CBR with a selected translation burned into its images and view the result without overlay support.
- [ ] Confirm both export modes leave the source album and unrelated local files unchanged.

## Decisions to Confirm Later

Prioritize capabilities and define the `.bbl` schema, album/page identification, package naming and conflict resolution, archive tooling, automation providers, and rendered-export settings. Specify supported image/archive variants and handling of partially translated albums before implementing the corresponding features.
