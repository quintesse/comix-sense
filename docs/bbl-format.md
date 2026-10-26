# Bubble file format (`.bbl`)

**Design decision: one translation language per `.bbl` file, always.** A document
may cover one page or several pages of the same language. Different languages must
use separate `.bbl` files; mixing languages in one document is intentionally unsupported.
Keep this constraint in future proposals, and flag requests that suggest mixing languages.
Per-bubble OCR locale metadata does not create additional translation languages.

Each `.bbl` file is JSON with a `pages` array containing page objects with ordered `bubbles` arrays. The reader preserves file/page metadata and matches album-index pages by their `filename`; legacy single-page sidecars may omit it.

The app and helper tools write `.bbl` and JSON output with two-space indentation
and a final newline for readability. Translation batches preserve number literals,
string escapes outside translated fields, and field order while formatting new files.

The shape-based format is illustrated below:

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

The optional bubble-level `style` object maps CSS property names to string values,
for example `"style": { "fill": "white", "opacity": "0.8" }`. It applies inline
CSS only to the mask's SVG rectangle, polygon, or rounded path, never to the text.
The app-specific `cornerRadius` key is excluded from inline CSS. `font` is also
at bubble level and controls text typography; `shape` and `layout` contain only
geometry. Page/album mask-style inheritance is not implemented; each bubble uses
its own style or the renderer's default mask appearance. `shape.style` is not used
as a fallback.

A bubble can have an optional independent rectangular text placement:

```json
{
	"text": "Hello!",
	"shape": {
		"type": "poly",
		"vs": [
			{ "x": 80, "y": 80 },
			{ "x": 300, "y": 90 },
			{ "x": 280, "y": 190 },
			{ "x": 90, "y": 180 }
		]
	},
	"style": { "fill": "#fff4cc", "opacity": "1" },
	"layout": {
		"type": "box",
		"vs": [
			{ "x": 100, "y": 100 },
			{ "x": 270, "y": 170 }
		]
	}
}
```

`shape` defines the original-artwork mask and blur clipping. `layout` defines
text position and wrapping bounds in original-image pixels. Only `box` with
exactly two opposite finite vertices and finite positive width and height is
valid for layout; either corner order is accepted. Layout can extend outside or
be completely separate from the mask. Typography, whitespace and overflow rules
are unchanged; text is not clipped to either geometry.

Without `layout`, text follows the current mask bounding box. Legacy files remain
visually unchanged and opening or saving does not create implicit layouts.
The presence of `layout` is the independence setting, even if it equals the mask
bounds. No linking flag is stored. Invalid optional layouts emit a deduplicated
`[bbl]` diagnostic and render using mask bounds; their source metadata is retained
without repair. Relinking explicitly removes layout.

The Text & Layout Settings panel separates by copying current mask bounds, and
relinks by removing layout. The active geometry target is transient editor state.
Mask conversion preserves bubble-level `style` and explicit layout. Whole-bubble
movement translates both geometries. OCR-created bubbles have no layout.
Grouping compares bubble-level mask styles and keeps independently positioned bubbles
separate, preserving their placement rather than choosing one input's layout.

### Mask appearance

Bubble-level `style` supports `cornerRadius`, `fill`, `stroke`, `stroke-width`,
and `opacity`, all stored as strings. For example:

```json
"style": {
  "cornerRadius": "12",
  "fill": "#ffffff",
  "stroke": "#000000",
  "stroke-width": "2",
  "opacity": "1"
}
```

Absent values mean square corners, white fill, no outline, and opacity `0.8`.
`stroke: "none"` explicitly disables the outline. Fill and stroke accept CSS
colours; stroke width and corner radius use original-image pixels. Opacity uses
SVG/CSS semantics and affects fill and outline together, leaving text unchanged.
Other existing style properties survive appearance edits.

`cornerRadius` is a custom nonnegative finite numeric string, not a CSS property.
Invalid values produce a `[bbl]` diagnostic and square corners while preserving
source metadata. Boxes apply the same radius on both axes, capped for rendering
at half the shorter dimension; the requested radius remains stored.

Polygons use circular fillets tangent to the incoming and outgoing edges. For a
signed turn angle θ between edge directions, the tangent distance is
`radius * tan(abs(θ) / 2)`, capped at half each incident edge's length. The actual
local arc radius is the capped distance divided by `tan(abs(θ) / 2)`. This prevents
adjacent transitions from overlapping along a shared edge and handles either
winding and concave turns. Consecutive duplicate vertices (including a repeated
closing vertex) are omitted only in the render copy. Collinear, reversing, or
numerically unsafe corners remain pointed. Zero radius retains the ordinary
polygon. Rounding can soften speech-bubble tails; it does not guarantee that
self-intersecting polygons become simple or prevent interactions across unrelated
edges in very narrow shapes.

The visible mask and artwork-blur clip share the rounded contour. Clipping uses
the filled contour without stroke expansion or appearance CSS. Stored vertices,
bounding boxes, editing handles, and text layout do not change. Conversion,
translation, browser recovery, and disk persistence retain bubble-level style.

## Typography and album indexes

These optional extensions are implemented for directory and archive albums.
Existing sidecars require no migration or format-version field.

### Font defaults and overrides

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

### Font resources

In edit mode, open **Text & Layout Settings** with **T** and expand **Advanced font
resources** to add, edit, or remove face definitions. This section is collapsed
by default and available for page and album scopes only. Page definitions go
in the page sidecar's root-level `fontFaces`, creating a sidecar if needed;
album definitions go in `album.bbl`. Use the family name in the regular font
settings to select the registered face. Definitions participate in the usual
Save/Discard and browser backup workflow.

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

### Album indexes and page filenames

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
`.<language>.bbl` (see the [saving guide](../README.md#save-or-discard-your-work));
image stems should be unique within an album.

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

### Combined example

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
resource declarations, filenames and geometry byte-for-byte. Bubble grouping is
described in the [grouping algorithm notes](../tools/bubblemerge.md).

### Recovery and diagnostics

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
Automatic text fitting, rich text and album export remain deferred.
