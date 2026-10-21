# Reimplementing the legacy OCR pipeline

This guide is based on static analysis of `E:/Projects/jbang/comix-sense-old`.
It describes the algorithms in that checkout, rather than current OCR service
capabilities. No live cloud requests were made. The proposed improvements below
are explicitly distinguished from legacy behavior.

## Source map

| Concern                              | Legacy source                                                  |
| ------------------------------------ | -------------------------------------------------------------- |
| Scan button binding                  | `static/js/main.js`, startup handler                           |
| Scan request and editor update       | `static/js/layout.js`, `analyze()`                             |
| HTTP entry point                     | `main.java`, `POST /analyze/<path>`                            |
| Full-page versus region scanning     | `main.java`, `handleAnalysis()`                                |
| Request batching                     | `main.java`, `analyzePage()`, `batched()`                      |
| Cropping and OCR response conversion | `main.java`, `analyzePartialPage()`                            |
| Word clustering                      | `main.java`, `groupWords()`, `overlapping()`, `merged()`       |
| Geometry                             | `main.java`, `Shape`, `Box`, `Poly`                            |
| Language normalization               | `main.java`, `normalizeLanguages()`                            |
| Translation                          | `main.java`, `translate()`; `static/js/text.js`, `translate()` |
| Saving                               | `static/js/main.js`, `save()`, `removeWords()`                 |

## What the old implementation actually does

The OCR engine performs text recognition and word localization. The application's
own algorithm groups those words by spatial proximity. It does not detect panel
borders, balloon outlines, tails, or whether text is dialogue, narration, a sign,
or a sound effect. Its generated "bubbles" are padded rectangles around text.

The old UI has one Scan Image action, applied to every selected page. For each
page it sends all existing bubble shapes. If there are any shapes, it rescans
those regions. Otherwise it scans the whole image and creates candidate bubbles.
It does not expose separate implementations for the current project's Scan Text,
Scan Page, and Scan Bubbles menu labels.

## 1. Define an OCR adapter and a separate geometry layer

Keep provider-specific requests and response formats out of the grouping code.
Use an internal result similar to this pseudocode:

```text
Word = { text, box, ordinal }
Recognition = {
  requestId,
  status: success | error,
  fullText,
  detectedLanguage?,
  words: Word[],
  error?
}
Region = { regionId, originalShape, cropBox }
Bubble = { text, shape, lang?, style?, words? }
```

`ordinal` and stable request/region identifiers are recommended additions. The
legacy code uses list position to correlate requests and results. All boxes and
shapes used by the editor should be in original page-image pixels, independent
of viewport size and zoom.

The legacy Google Cloud Vision adapter requests `TEXT_DETECTION`. It treats the
first text annotation as aggregate text plus detected locale, and subsequent
annotations as individual words. Another provider must be adapted explicitly;
do not assume its first item has the same meaning. Full text alone is sufficient
for a selected-region rescan, but automatic grouping needs word positions.

## 2. Choose scanning scope explicitly

To reproduce the old behavior:

1. Decode the original image and obtain its width and height.
2. If supplied regions are nonempty, use them in their existing order.
3. Otherwise use one temporary region spanning `(0, 0)` to `(width, height)`.
4. Recognize each region.
5. Only for the temporary full-page region, group its recognized words into
   candidate bubbles. Discard the temporary page-sized bubble.
6. Normalize language metadata and return one page of bubbles.

For the new application, make scope an explicit command parameter instead of
inferring it from whether regions happen to exist:

- **Scan Text:** rescan the clicked bubble and retain its shape and style.
- **Scan Bubbles:** rescan all existing bubbles on the chosen page.
- **Scan Page:** recognize the entire page and propose new text-region boxes.

These three action semantics are a proposed mapping for the current menus.
Define how page-scan proposals are accepted before replacing existing work.

## 3. Crop regions and restore page coordinates

For each selected shape, calculate its axis-aligned bounding box:

```text
x1 = minimum vertex x
y1 = minimum vertex y
x2 = maximum vertex x
y2 = maximum vertex y
crop = image[x1:x2, y1:y2]
```

The legacy code uses this rectangular crop even for polygons. It does not mask
pixels outside the polygon. Keep the original polygon as the bubble's output
shape; a bounding box is only the recognition input. Polygon masking would be a
separate enhancement and could change results.

OCR coordinates are local to the crop. Restore page coordinates by adding the
crop origin to every returned vertex, then calculate the word's bounding box:

```text
pageX = cropX + x1
pageY = cropY + y1
```

If a replacement adapter resizes or rotates input, apply the inverse transform
before adding the crop origin. Use the actual clipped crop origin if clipping
was required. Reject nonfinite coordinates and zero-area crops; clamp valid
crop bounds to the image. The old implementation does not perform these checks.

For selected regions, preserve aggregate recognized text, including internal
line breaks, after trimming leading/trailing whitespace. An empty successful
result produces empty text and an empty word list. Keep this distinct from an
OCR failure.

## 4. Batch requests without losing identity

The legacy default is at most 16 region images per request, configurable by
`--images-per-request`. This is a historical application setting, not a claim
about any provider's current limit. Larger selections are split into batches,
and those batches are processed sequentially on the server.

Use consecutive slices and retain original indexes. The old `batched()` groups
items into a map and iterates its values, which does not explicitly guarantee
batch order. Match every response to a request ID and restore selection order.
Validate response counts. Bound page-level concurrency too: the old UI starts
requests for all selected pages without a queue.

Return failures as structured metadata. The old server writes `ERROR: ...` into
bubble text and leaves `words` null. A full-page scan then calls `words.stream()`
and can fail. A failed recognition must retain existing user text and must not
enter the word-clustering stage.

## 5. Reproduce the legacy word-grouping heuristic

Represent each recognized word by an axis-aligned box. Visit words in the
provider's returned order. Maintain an ordered list of candidate groups.

For the incoming word `w`, calculate:

```text
margin = floor(0.75 * height(w.box))
```

The old proximity predicate for boxes `a` and `b` is:

```text
near(a, b, m) = NOT (
  a.x1 - b.x2 >= m OR b.x1 - a.x2 >= m OR
  a.y1 - b.y2 >= m OR b.y1 - a.y2 >= m
)
```

In other words, separation on every axis must be strictly less than the
margin. A gap exactly equal to the margin does not qualify. With margin zero,
boxes must overlap with positive extent on both axes; touching is insufficient.

A group matches the incoming word only when both conditions hold:

1. Its padded group box is near the incoming word box.
2. At least one actual word in the group is near the incoming word box.

The second condition avoids accepting a word merely because it lies in a large
empty space inside a group's bounding rectangle.

```text
groups = []
for word in wordsInProviderOrder:
  margin = floor(0.75 * height(word.box))
  matches = groups.filter(group =>
    near(word.box, group.box, margin) AND
    any(member in group.words: near(word.box, member.box, margin)))

  if matches is empty:
    groups.append({
      words: [word], text: word.text,
      box: expand(word.box, 5)
    })
  else:
    members = concatenate(matches' word lists in current group order)
    members.append(word)
    merged = {
      words: members,
      text: join(members' texts, " "),
      box: expand(boundingBox(members' boxes), 5)
    }
    remove matches from groups
    groups.append(merged)
return groups
```

Each expansion is five image pixels on every edge. Recompute a merged box from
its words and pad once; do not accumulate padding on every merge. A new word can
bridge and merge multiple groups. The legacy merge also combines styles in
group order, with later values winning, and takes the first group's language.
In normal full-page scanning those groups inherit the same initial metadata.

The straightforward algorithm can take quadratic time in the number of words.
Start with the simple version for parity; add spatial indexing if measurements
justify it, while keeping candidate and merge order deterministic.

### Limitations to address deliberately

- **Reading order:** concatenating whole group lists can reorder words when a
  later word bridges groups. Merging moves the resulting bubble to the end of
  the bubble list. Save original ordinals and preserve or reconstruct reading
  order separately. Using ordinals is an improvement, not exact legacy parity.
- **Line breaks:** grouping joins words with spaces and loses full-page OCR line
  breaks. Region rescans retain aggregate OCR line breaks. Prefer provider line
  structure for reconstructed text when available.
- **Scale and asymmetry:** five-pixel padding is resolution-dependent, and the
  margin depends only on the incoming word's height. Reordering differently
  sized words can change the groups. Any symmetric distance rule, resolution
  scaling, or connected-component replacement changes legacy behavior.
- **False merges:** adjacent balloons, captions, and sound effects can merge.
  Large lettering can bridge otherwise separate groups. Add panel/line/region
  constraints only as separately evaluated improvements.
- **Edges:** padded boxes can extend outside the page. Keep legacy geometry in
  parity fixtures; clamp proposed editor boxes in the improved version.
- **Missing word geometry:** a provider may supply text without usable word
  boxes. Return an explicit unsupported-grouping result or another documented
  fallback; silently returning no bubbles would lose recognized text.

## 6. Normalize language metadata

For each recognized region, the old adapter stores its detected locale on the
bubble unless it equals the configured expected language, ignoring case. It
then counts languages across bubbles, falling back to the expected language
when a bubble has no explicit language.

If no expected language was supplied, the most frequent language becomes the
comic default. Matching bubble-level languages are cleared so they inherit that
default. Other languages remain explicit. If an expected language was supplied,
it stays the default even when the detected majority differs; the server only
logs a warning. Ties are not resolved deterministically.

The expected language is not sent as an OCR language hint in the old request.
Whole-page groups all inherit the aggregate annotation's detected language;
there is no independent per-bubble language recognition in that mode.

Recommended changes: normalize absent/empty language codes, choose a stable tie
rule, expose detected-versus-expected disagreement for review, and keep unknown
language distinct from a confirmed language. The legacy count is by bubble,
not by characters, words, or confidence. Source language must not be inferred
from a target overlay's filename or current UI selection.

## 7. Integrate results without losing edits

The old client replaces the page's bubble array, updates its language, and marks
the current overlay as changed. A rescan recreates bubbles, so existing styles
and corrected text can be lost. Deleting a bubble moves its recognized words
into a temporary `unselectedWords` list for display; no automatic regrouping is
implemented for that list. Save strips all `words` arrays before writing `.bbl`.

Recommended application behavior:

1. Associate scan results with page identity, source language, region identity,
   and the editor revision at request time.
2. Keep raw recognition separate from corrected text and translation overlays.
3. Stage full-page candidates for review; apply selected-region results while
   preserving geometry, style, and unrelated bubbles.
4. Prevent a delayed response from overwriting edits made while OCR was running.
5. Retain enough word/provenance metadata for correction and regrouping, either
   in a versioned schema or a separate record. Do not add fields accidentally to
   existing files or silently rewrite reviewed overlays.
6. Support undo, visible per-page errors, cancellation, and bounded concurrency.

In the current project, `Comic.setBubbles()` retains session edits, and
`PageImages` supplies original dimensions and manages image URL lifetimes.
Keep an image protected while an asynchronous scan needs it. Existing `bounds()`
can calculate boxes, but `Box.boundingBox()`, `Box.poly()`, and their `Poly`
counterparts are still unimplemented; do not build scanning on those stubs.
The current `Bubble` type has no word metadata field.

The current app is statically prerendered with the static adapter. Full-page
scanning now calls Google Vision directly from the browser using a user-provided
API key. The optional remembered key is stored in localStorage; service-account
credentials are not used. `src/lib/ocr.ts` follows the two Java tools' word-box
conversion, rather than the legacy grouping heuristic described above. Results
are held in a separate session-only OCR overlay. See the README for configuration.

## 8. Keep adjacent features separate

The old translation algorithm flattens bubble texts across pages, translates
them as an ordered list, then reconstructs the same page/bubble structure using
response order. It preserves geometry and styles, sets the target language as
the comic default, and omits word data and bubble language overrides. It has no
glossary, contextual prompting, or independent translation review model. Use
stable bubble IDs and response-count checks when reproducing this pipeline;
do not copy its hard-coded cloud project identifier.

The old rendering overlays a blurred copy of the image clipped to bubble
shapes, adds translucent white shapes, and places editable HTML text over them.
This is visual concealment, not an algorithm for removing original lettering
or fitting replacement text to balloon contours.

## 9. Acceptance cases for a reimplementation

Use provider-independent recorded word results to test the geometry and
grouping separately from OCR quality. These are proposed tests, not tests run
as part of this analysis.

- A crop at `(100, 200)` with a local word at `(10, 20)` restores `(110, 220)`.
- Polygon scanning uses its bounding rectangle but retains polygon geometry.
- Margin comparison covers gaps just below, exactly at, and above the threshold.
- Empty space inside a group's large box does not bypass the member-word check.
- A bridging word merges two groups and padding stays five pixels, once.
- Provider order and improved reading order are tested as distinct behaviors.
- Empty successful OCR returns no full-page candidates and an empty region text.
- Failed OCR produces an error without text replacement or a null-word crash.
- More than one request batch preserves region identity and output order.
- Unknown language, mixed languages, tied counts, and expected-language
  disagreement have deterministic, documented outcomes.
- Invalid and out-of-bounds crops are handled without provider calls or crashes.
- Cancellation, navigation, and edits during scanning cannot misapply results.
- Saving/reloading retains the intended metadata and preserves unrelated files.

Implement and verify the adapter, coordinate conversion, grouping, and language
rules as independent units first. Then connect the scan commands to staged
editor updates. Evaluate reading-order and grouping improvements against real
pages separately from the legacy parity fixtures.
