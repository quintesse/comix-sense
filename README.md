# Comix Sense

Comix Sense is a browser app for reading comics and creating editable translations
over the original artwork. Open comics from your computer, read an existing
translation, or turn scanned dialogue into speech bubbles you can correct,
translate, and style. Translations live in separate `.bbl` files, so several
languages can share the same comic without altering its original images.

Your comic library stays on your computer. Reading and manual editing happen in
the browser; optional OCR and AI tools send content to the providers you configure.

## Features

- **Read local comics:** browse image albums and CBZ, ZIP, or CBR archives with
  thumbnails, one-page and two-page layouts, and fit, width, or percentage zoom.
- **Switch languages:** view original artwork or translated speech-bubble overlays.
  The app remembers reading positions and language choices.
- **Edit bubbles:** correct text, draw boxes or polygons, move and resize shapes,
  and adjust typography for an album, page, or individual bubble.
- **Recognize and translate text:** scan with Google Cloud Vision, clean up OCR
  text, and translate it through a compatible AI provider.
- **Render translated artwork:** use an image model to create a translated page
  image alongside the original.
- **Keep editable files:** browser backups protect work between sessions, while
  explicit saving writes portable `.bbl` documents beside your comics.

## User guide

### Open your comics

Use Chrome or Edge with local directory access enabled. To run the app yourself,
follow the [local setup instructions](docs/development.md#developing) first.

1. Open the sidebar and click **+ (Add folder)**.
2. Choose a directory containing your comics and allow the browser to read it.
3. Expand the comics tree and select a page, or open an archive to load its pages.
4. Use the thumbnails below the tree to jump to another page in the album.

A **page** is one comic image. An **album** is an ordered set of pages in a
directory or archive. A **collection** groups albums and can contain nested
collections and loose pages. You can add several directories to the sidebar.

Supported images are BMP, GIF, JPG, JPEG, PNG, and WebP. Supported archive
extensions are `.cbz`, `.zip`, and `.cbr`. Add the directory containing an archive;
standalone file import and drag-and-drop import are not implemented. Encrypted,
multipart, and nested archives are unsupported. Large or incompatible archives
may exceed the reader's [archive limits](docs/archives.md).

The app restores previously opened directories and reading positions when browser
permissions allow it. If access needs renewing, click **Reopen** for that directory.
Removing a directory from the sidebar disconnects it from the app.

### Read and navigate

Choose **Reading Mode** in the toolbar. Select a one-page or two-page layout and
use the zoom menu to fit the page, fill the available width, or set a percentage.
In Reading Mode, clicking the left or right half of the reading pane moves backward
or forward. Navigation stops at the album's ends.

| Control                                 | Action                                 |
| --------------------------------------- | -------------------------------------- |
| Left / Right Arrow, Page Up / Page Down | Previous / next page or spread         |
| `1` or `S` / `2` or `D`                 | One-page / two-page layout             |
| `L`                                     | Locate the current page in the sidebar |
| `R` / `E`                               | Reading Mode / Edit Mode               |
| `B`                                     | Show or hide translation bubbles       |
| `T` in Edit Mode                        | Open or close Text & Layout Settings   |

Typing fields retain their editing keys; arrow keys also retain their normal
behavior in menus and the sidebar tree.

Choose **ORG** in the language menu to see the original page, or choose a language
to display its overlays. **Show Translations** toggles the bubbles without changing
the selected language. When a rendered image exists for that language, Reading
Mode displays it. Otherwise, Reading Mode shows the original image with the selected
language’s `.bbl` overlay when available, or just the original if neither exists.
This fallback applies to each page separately, including two-page layouts. Edit
Mode always uses the original image with editable bubbles.

### Scan a page or album

Scanning is optional if your comic already has text overlays.

1. Select a page and switch to **Edit Mode**.
2. Open **OCR Settings** and enter a Google Cloud Vision API key with Cloud Vision
   enabled, or enter the key when prompted on your first scan.
3. Click **Scan Full Page**, choose **Current page** or **Entire album**, then click **Scan**.
   Recognized text appears in an editable **OCR** overlay on each scanned page.
4. Review the text and bubble shapes before translating.

Scanning sends each original page image directly to Google and may incur provider
charges. Rescanning asks for confirmation before replacing existing OCR overlays.
Album scans process pages in order; if a scan fails, completed pages are kept.
In a two-page layout, **Current page** scans only the selected page.

### Configure AI tools

Open **OCR Settings → AI provider**. Enter your provider URL, an API key if required,
and separate models for **Cleanup**, **Translation**, and **Render** as needed.
Model suggestions appear when the provider supports listing models; you can also
type a model ID. Click **Save settings** to apply your choices.

Cleanup and translation require an OpenAI-compatible Chat Completions provider
with strict JSON Schema output. Rendering requires an OpenAI-compatible image
edits endpoint and a model that supports custom image dimensions. The provider
must allow browser requests through CORS. A base URL such as
`https://api.openai.com/v1` can be used for the shared provider configuration.

Each tool's **Edit prompt** lets you customize its instructions, insert
`{sourceLanguage}` and `{targetLanguage}`, or restore the default. Set models only
for the tools you plan to use.

Keys remain in memory unless you select **Remember on this browser**. Remembered
keys use unencrypted browser storage; **Forget key** clears the corresponding key.
Provider calls may incur charges. Cleanup and translation send bubble text;
rendering sends the page image and source/translated text.

### Clean up and translate text

1. In **Edit Mode**, select **OCR** or another source text overlay. **ORG** has no
   extracted text, so scan the page first if needed.
2. Optionally click **Cleanup Text**, choose **Current page** or **Entire album**,
   then click **Clean text**. Album cleanup affects pages with the selected overlay.
   Review the results: cleanup receives text only and cannot check the artwork.
3. Click **Translate**, choose the target language, and click **OK**. Translation
   applies to the selected page. Confirm **Overwrite and translate** if that
   language already exists.
4. Review the selected target overlay and correct any wording or layout issues.

Translation creates an independent target overlay with copied shapes and styles.
Source text remains available. If a response omits bubbles, the app warns you and
keeps existing target text where available, otherwise source text. Review those
bubbles before saving. You can cancel an AI text request while it runs.

### Edit bubbles and typography

With a text overlay selected in **Edit Mode**:

- Click bubble text to edit it. On a linked bubble, drag its handles to adjust
  the mask and the text bounds together.
- Hold **Shift** and drag, or use the middle mouse button, to move a whole bubble.
- Choose **Draw Boxes** and drag between two opposite corners to add a box.
- Choose **Draw Polygons**, drag the first edge, click more vertices, and click near the first to close it.
- Press **Escape** to cancel drawing. **Backspace** removes the last polygon vertex
  or cancels a box.
- Right-click bubble text to convert its shape or delete it.
- Open **Text & Layout Settings** (`T`) and use the **Album**, **Page**, or **Bubble** scope buttons to
  adjust family, size, weight, style, line height, and spacing. Select a bubble
  before changing its individual font. Selecting a bubble updates the open panel's
  target without changing your chosen scope or opening the panel. Opening the
  panel with a bubble selected automatically chooses **Bubble** scope.
- Right-click a bubble and choose **Bubble settings** to open the panel at
  selected-bubble scope. **Separate text and mask** creates an independent rectangular
  text area at the current mask bounds; it is also available in the context menu.
- At **Bubble** scope, **Edit: Text area | Mask** switches the panel's controls.
  **Text area** shows text linking/separation and **Text appearance** font settings; **Mask** shows shape
  conversion and mask appearance. These buttons are available for linked text too.
  For independent bubbles, choose a part, then drag that part's
  resize handles or visible move grip. The dashed text outline and solid mask
  outline have labels. Click text to edit it and select the text area.
- With **Mask** selected, **Mask appearance** adjusts **Corner radius** (slider or image-pixel
  value), **Fill colour**, **Outline** colour and image-pixel width, and **Opacity**
  (0–100%). Use the **Fill colour eyedropper** or **Outline colour eyedropper** to
  sample a colour from the screen, then click the desired pixel; press Esc to cancel.
  Screen sampling requires browser support and a secure connection (or localhost).
  If unavailable, use the colour picker or editable value. Sampling happens locally
  and does not upload screen contents.
  Changes appear immediately and affect only the selected mask, leaving
  text layout and typography unchanged. Rounding also softens polygon tails.
  Enlarging a mask covers artwork; it does not reconstruct artwork or erase old
  borders outside the mask's area. Save these edits with **Save Changes**, or use
  **Discard Changes** to revert them; browser backups are recovery copies, not disk saves.
- Convert the mask between box and polygon in the panel while editing the mask.
  **Fit text area to mask and link** removes independent placement and makes text
  follow the mask again. Neither action changes typography.
- **Shift-drag** or middle-button drag moves both parts together, preserving their
  relative positions. New bubbles start with text following the mask.

Font properties inherit from broader scopes unless overridden. Advanced font
resources let you register local font files or HTTPS font URLs for page and album
scopes. See the [BBL reference](docs/bbl-format.md) for inheritance and resource paths.

### Save or discard your work

Edits are backed up in this browser after a short pause. These backups are separate
from your comic files: **Save Changes** is required to write edits to disk.
Closing the browser before a backup completes can lose the latest edits, and
clearing site data removes backups.

Pages with unsaved changes have bold names in the tree and keep their normal
page, language, or OCR icons. Their parent albums and collections have bold names
and outline icons. Unsaved languages appear in bold
in the language menu. Browser backup does not clear these indicators. The tree
includes edits in every language, while Save and Discard follow the selected
language. On a marked page, select a bold language entry to save or discard its
changes.

- **Save Changes** writes the document supplying the selected page and language,
  requesting write permission if needed. If that document covers several pages,
  their edits are saved together. Other documents and languages remain unsaved.
- **Discard Changes** asks for confirmation, removes that document's browser
  backup, and reloads its disk version. A new overlay with no saved file disappears.

There are no Save All or Discard All actions. Removing a directory from the sidebar
keeps its backups for when you add it again.

New translations use the image stem and language code: `01.png` gets `01.en.bbl`.
New OCR overlays use `01.OCR.bbl`. Existing documents keep their filenames and may
cover one or several pages, with one translation language per document.

For archives, saved overlays go into a companion directory without rewriting the
archive. For example, `pages/01.png` in `book.cbz` gets a new English overlay at
`book.cbz.bbl/pages/01.en.bbl`. Saved companion documents take precedence over
embedded ones. Keep the companion directory alongside the archive when moving
or sharing your editable translations.

### Render a translated page

1. Select a translated overlay in **Edit Mode** on a directory page.
2. Ensure the page also has an **OCR** overlay with matching bubble counts; rendering
   pairs its source text with the translation by index.
3. Configure the **Render** model in AI provider settings. Choose quality and output
   format (`png`, `jpg`, or `webp`), and optionally customize its prompt.
4. Click **Render Page** and allow write access when requested.

The app saves `<page>.<language>.<format>` beside the original and switches the
selected page to Reading Mode. Rendering again replaces the image at that output
path. Original images and BBL documents are preserved. Rendering writes directly
to disk, independently of **Save Changes**, and can be cancelled while running.
Archive pages, **ORG**, and **OCR** cannot be rendered.

### Further documentation

- [Development and command-line tools](docs/development.md): local setup, validation,
  static builds, and extracting bubble text.
- [BBL file format](docs/bbl-format.md): sidecars, album indexes, typography, and
  matching rules.
- [Archive reference](docs/archives.md): supported formats, resource limits, and
  known decoder limitations.
- [Product specification](SPEC.md): project direction, including planned capabilities.
