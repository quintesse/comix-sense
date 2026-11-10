# Offline merge evaluation

Evaluate the production merger locally against reviewed word assignments and saved baselines.

## Run a synthetic demonstration

After `npm ci`, run from the repository root using the supported Node version:

```sh
npm run evaluate:merge -- --dataset tests/fixtures/merge/synthetic.json --output E:/merge-demo-baseline
npm run evaluate:merge -- --dataset tests/fixtures/merge/synthetic.json --output E:/merge-demo-comparison --baseline E:/merge-demo-baseline/report.json
npm run test:merge-eval
```

Output must be a **new directory**, with an existing parent. Choose paths appropriate
to your machine. On Windows, if a PowerShell npm wrapper consumes the flags, run
the same command through `cmd /c "npm run evaluate:merge -- ..."`.
The runner needs no browser, server, credentials, network, or OCR service.
It uses the installed TypeScript compiler through a local Node module loader.
`report.json` is both the detailed result and a reusable baseline. Open
`index.html` directly from disk. It shows expected reviewed groups, actual groups,
stable source IDs, final text rows, metrics, and comparison differences. With a
baseline it also shows previous groups. Without an image it draws word geometry;
with a local PNG/JPEG/WebP it embeds a read-only copy as a data URL. No external
scripts, fonts, services, or hosting are used. The source table exposes original text and labels. Normal browser zoom helps with
dense pages. Gray expected words have no reviewed group; color is only membership.

## Private datasets

For repeatable comparisons, scan with **Automatically merge bubbles** unchecked,
choose **Save Changes**, and copy the resulting word-level OCR `.bbl` file into
the private investigation directory before merging or editing it. Keep the copy
as an immutable input and use the same words and geometry for each comparison.
An overlay already saved with merged passages lacks the original word positions.

Keep comics, OCR, annotations, crops, and detailed reports outside the checkout or
under ignored `comics/`. The runner rejects output elsewhere inside the checkout,
including through resolved symlinks. It never overwrites an existing output directory.
It reads only the specified dataset, baseline, and explicitly referenced images;
it does not search for comics or call OCR. Source files are never written.
Reports contain text and potentially full page images: keep them local and do not
force-add private files. Only invented fixtures belong in public CI.

## Dataset schema version 1

The root is `{ "schemaVersion": 1, "pages": [...] }`. Page IDs are unique,
nonempty strings; words have unique nonempty IDs within each page. IDs identify
source records, including duplicate text and empty text. A page contains:

| Field             | Meaning                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`              | Stable page identity; comparison matches by ID, never page position.                                              |
| `words`           | Ordered original OCR word records. Input order is significant for merger tie-breaking and inherited metadata.     |
| `image`           | Optional local image path relative to the dataset JSON, or an absolute local path. URLs are rejected.             |
| `imageSize`       | Optional `{width,height}` in original image pixels; positive finite numbers. Supply this for full-page alignment. |
| `completeBubbles` | Optional list of reviewed bubble labels whose source-word membership is fully annotated.                          |
| `order`           | Optional explicit `[beforeWordId, afterWordId]` relationships, referencing reviewed words.                        |
| `notes`           | Optional review notes, provenance, selection scope, or unresolved ambiguities.                                    |

Each word contains `id`, original `text` (including empty strings), and `shape`.
Shapes use the app representation: `{type:"box",vs:[{x,y},{x,y}]}` or
`{type:"poly",vs:[{x,y},...]}` with at least three polygon vertices. Coordinates
must be finite, with positive bounding width and height. Polygon grouping uses
bounds, as in the app; original vertices are retained. Boxes may list corners in
either order. Polygon simplicity is not imposed beyond the app's geometry contract.

Optional `lang`, `style` (string-to-string map), and `layout` (a two-vertex box)
reproduce current compatibility rules, including undefined versus present values.
Do not inject page language defaults that were absent from original inputs.
`extended` can hold any JSON provider metadata; it is retained and hashed but never
sent to the merger. Font metadata is outside this normalized word schema because
it does not influence current compatibility. Unknown word fields are rejected.

Optional `review` is one of:

```json
{ "status": "reviewed", "bubble": "dialogue-A", "line": "row-1" }
```

```json
{ "status": "ambiguous", "reason": "Association unclear in image" }
```

Statuses are `reviewed`, `unreviewed`, `ambiguous`, and `excluded`. Omitted review
means unreviewed. Only reviewed words may have `bubble` and optional `line` labels.
Reviewed words require a bubble label. Line labels are scoped to a bubble; label
names are arbitrary, and renaming them does not change metrics. Nonreviewed words
remain merger inputs and remain visible. Exclusion affects evaluation only, not
app filtering or predicted membership. Use `reason` for reviewer decisions.

Missing line labels imply no line relationship, not a separate line. Bubble
annotations establish reviewed equivalence relationships even when incomplete.
`completeBubbles` is a deliberate reviewer assertion that all supplied source words
belonging to that bubble are annotated; it does not assert OCR recognized every
letter in the image. A predicted group containing additional unreviewed, ambiguous, or excluded words
is unscored for exact membership: unknown material cannot become an implicit
negative. `exactBubbleUnscored` records this coverage loss.

Duplicate IDs, unknown references, invalid geometry, labels on nonreviewed words,
unknown complete-bubble labels, duplicate order edges, and cyclic order assertions
are rejected before merging. Order edges are individually reviewed constraints;
the evaluator does not invent additional transitive labels.

## Metrics and denominators

Grouping is evaluated **before** `mergeOcrBubbles()` removes groups without Unicode
letters. App filtering is separately reported as kept/removed group counts.
Diagnostics partition every original word exactly once into groups and final
reconstructed rows, including singletons, punctuation, and empty text. Membership
comes directly from merger source indexes, never output text or outline containment.
Group array order and row/member array order are the merger's reading order.

| Metric              | Denominator / interpretation                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `falseJoins`        | Unordered reviewed word pairs from different expected bubbles, denominator `differentBubblePairs`.                                                                                                                  |
| `falseSplits`       | Unordered reviewed word pairs in the same expected bubble, denominator `sameBubblePairs`.                                                                                                                           |
| `exactBubbles`      | Full source-ID set matches, denominator `exactBubbleEligible`: asserted complete bubbles whose touched predicted groups contain only reviewed words. Extra reviewed members fail exactness.                         |
| `lineErrors`        | Same expected-bubble pairs with both line labels reviewed, denominator `linePairs`. Error when expected same/different row differs from predicted group-and-row identity. Bubble splits therefore also split lines. |
| `orderErrors`       | Violated explicit before/after constraints among comparable predictions, denominator `orderPairs`.                                                                                                                  |
| `orderIncomparable` | Constraints whose same/different bubble relationship is not reproduced. Reported separately; never silently counted as correct order.                                                                               |

Cross-bubble order compares predicted group positions only if the words remain in
different groups. Internal order compares final rows, then left-to-right members,
only if the words remain in one group. Split internal groups or joined external
groups make those order constraints incomparable. This separates grouping errors
from ordering errors while exposing loss of comparability.

Coverage counts words by review status, plus `lineReviewed`, pair denominators,
complete bubbles, and comparable/incomparable order assertions. There is no overall
pairwise accuracy dominated by unrelated words. Aggregate fields sum page counts
(micro aggregation); rates, if calculated, divide summed errors by summed eligible
denominators. Zero denominators mean unavailable, not perfect. Report both page
counts and aggregate counts when assessing a change. `runtimeMs` per page times
the merger adapter; run runtime includes merging and evaluation, excluding imports,
image embedding, Git inspection, and output writing. Timing is observational and
not a deterministic performance gate.

## Baselines and provenance

Reports record dataset/report schema, metric version, input and label SHA-256
hashes per page, algorithm identity, Git revision, checkout dirty state (including
untracked files), implementation hash, Node version, and current fixed policy.
Implementation identity hashes the merger, runtime model dependencies, OCR filter,
adapter, evaluator, CLI/report, TypeScript loader, and dependency lockfile contents.
Thus a dirty checkout with the same revision is not claimed to have identical
implementation. Optional extended metadata is part of the input identity. Images
and notes are review aids, not algorithm/label inputs; their bytes are not hashed.

Input hashes preserve source word order; object key order is canonicalized. Label
hashes include statuses, reasons, explicit completeness and order assertions.
Renaming labels leaves metrics invariant but intentionally invalidates an existing
baseline's label hash. Reordered page lists are compatible. Added/removed cases,
changed source inputs or annotations, schema/metric versions, or algorithm identity
are incompatible. Different code/implementation hashes are allowed and recorded:
this is precisely what an algorithm change is intended to compare.

Compatible comparisons recompute previous metrics from saved source-ID assignments.
They show behavior changes, signed metric deltas (including exactness eligibility),
and individually improved or regressed reviewed relationships, so equal aggregate
counts cannot hide offsetting changes. Negative error deltas and positive
exact-match deltas indicate improvements when eligibility is unchanged.
Exact membership improvements/regressions require eligibility in both runs.
An unreviewed behavior change has no correctness claim. The baseline is evidence
of prior behavior; only reviewed annotations define correctness. Incompatible
comparisons produce a clearly marked report with no comparison metrics.

Exit codes: **0** valid run/comparison with no reviewed regressions; **2** invalid
input, arguments, output path, or I/O failure; **3** incompatible/unreadable baseline;
**4** compatible comparison with any newly regressed reviewed relationship
(including lost order comparability), even if other relationships improve.
A first baseline can contain errors and still exit 0.

## Opt-in decision analysis

Add `--trace` to the evaluation command to include decision events in the JSON and HTML reports.

The existing `mergeBubbles(bubbles): Bubble[]` and
`analyzeMergeBubbles(bubbles): MergeGroup[]` interfaces remain compatible. They
share the production policy and do not collect decision events. Offline tools can
call `inspectMergeBubbles(bubbles): MergeAnalysis` from
[src/lib/mergeBubbles.ts](../src/lib/mergeBubbles.ts). It returns:

- `groups`: the same output bubbles, ordered source indexes and final rows as
  `analyzeMergeBubbles`, before app letter filtering.
- `sources`: input indexes, bounds, original text and `normalizedText` after the
  existing whitespace cleanup. These describe this invocation's supplied bubbles;
  they identify the words supplied to this run.
- `decisions`: deterministic events with sequential IDs, phase, candidate
  membership snapshots, measurements, limits, failed predicates, decision and,
  where applicable, the existing tie policy.

Source indexes identify input positions, including duplicate and empty text.
Candidate membership is captured before rows/runs grow; it is not an inferred
output identity. Event IDs and candidate references are stable for identical
ordered inputs and implementation, not across changed inputs or future versions.
`grouping` covers provisional rows through fragment reconnection; `assembly`
covers the separate reconstruction of final text rows. Outline generation,
formatting and earliest-source metadata inheritance remain downstream of grouping.

| Stage                    | Candidate roles, in order                                                    | Interpretation                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `row`                    | Incoming word; existing row, if any                                          | Height/center gates, punctuation exception, incumbent distance, provisional best replacement and final assignment/new row. Equal distance retains the first created row. |
| `row-punctuation`        | Incoming punctuation; visited neighbor                                       | Vertical contact, horizontal gap and actual neighbor-height reach. Visits stop at the first witness, as before.                                                          |
| `run`                    | Current run, if any; incoming word                                           | Gap to the run's right bound and row-height cutoff; equality appends.                                                                                                    |
| `gutter-pair`            | Target run; left evidence run; right evidence run                            | Local gap, row distance/alignment, coverage and compatibility predicates. Rejected pairs do not search boundaries. Self pairs are structurally omitted.                  |
| `gutter-boundary`        | Word before boundary; word after boundary; left evidence; right evidence     | Search bounds, word gap, gutter distance and existing `gap - 0.08 * distance` score. Strict improvement replaces the incumbent; ties retain the first boundary.          |
| `gutter-selection`       | Target run; left evidence; right evidence; selected boundary words, if any   | Final cut proposed by that evidence pair, or no eligible boundary. Cuts from all eligible pairs accumulate; inferred cuts never become evidence.                         |
| `continuation`           | Upper line; lower line                                                       | Compatibility, heights, center separation, overlap/gap and, after the early gates pass, normalized alignment and existing cost.                                          |
| `continuation-selection` | Upper line; lower line; upper's chosen successor; lower's chosen predecessor | Candidate cost, winning costs and mutual choice or competing choices. Strictly smaller cost wins; equal costs keep the first sorted-line pair visited.                   |
| `fragment`               | Upper line; lower fragment; chosen sibling                                   | Mutual sibling, center distance and overhang gates. Skipped cases instead list lower line and its predecessor, if present.                                               |

Reasons name failed predicates of the unchanged policy, sometimes more than one;
they are not a claim about which short-circuited expression originally ran first.
`replace-best-*` is provisional, not a final join. Follow the later assignment,
cut, mutual-choice and fragment events. A missing gutter-boundary event means its
evidence pair failed earlier, not that the boundary was measured and preferred
uncut. A nonmutual continuation may still join through the fragment exception.
`Infinity` is ineligible, not an uncertainty score. No new scores, provider hints,
textual evidence, alternative search or probabilities are introduced.

### Offline report and local viewer

The adapter's `inspect(page)` maps invocation indexes to dataset word IDs. Each
page's optional `diagnostics` has its own `schemaVersion: 1`, a source table, a
`candidates` dictionary (`{id, members}` entries), and decision events referring
to those candidates. Repeated memberships are interned in first-use order. JSON
uses strings `Infinity`, `-Infinity` and `NaN` for nonfinite measurement values;
they must not silently become null. Production bubbles never contain this data.

Open the report's **Decision trace** section, enter an exact **Source ID**, and
select a **Stage**. The viewer displays 100 matching events at a time; **Previous**
and **Next** navigate them. Candidate source links open the original source table.
Its records omit bulky `extended` metadata for readability; `report.json` retains
it. All content stays local; private strings are escaped or inserted as text.
Report JSON is streamed to support enriched datasets larger than a single runtime
string. Full traces can still be large, especially the cubic gutter-pair traversal;
this is an offline investigation tool, with additional memory and runtime cost.

Diagnostics live beside `groups`, not inside them. Baseline compatibility and
`behaviorChanged` continue to compare inputs, labels, metrics and complete output
groups. Adding/changing traces alone neither invalidates an older compatible
baseline nor hides output changes. No schema/metric/algorithm version was bumped.

### Replay the Merge dialog options

Run `node --import ./tools/merge-eval/register.mjs tools/vision-pilot/enclosure-compare.mjs --inputs manifest.json --output review.json`
to compare all four combinations of balloon boundaries and inclined text locally.
Each manifest entry supplies `id`, `width`, `height`, `ocr` (a single-page OCR BBL),
and `rgba` (original, unscaled four-channel pixel bytes). Put entries in a JSON array.
Paths in entries are relative to the manifest. You can repeat `--inputs` for additional
manifests. The report contains each option combination's complete ordered bubble list.

### Candidate experiment for enclosure joins

Investigate whether a large difference in lettering inclination can identify
groups that should stay separate inside a shared enclosure. The [row grouper](../src/lib/mergeBubbles.ts) already
measures OCR quadrilateral top-edge slopes for reading order. A future join
experiment can reuse those measurements. Record the angle difference and the
length of the measured edges for each proposed join. A one-pixel change on a
short edge can move the estimated angle by several degrees.

Two Apekermis review examples illustrate the overlap at small angles. On page
29, the signature and adjacent digits differ by 2.9°. On page 4, the words
*het raam* belong together and differ by 3.2°. For larger differences, compare
confirmed false joins with genuine mixed-angle lettering on independent pages
before choosing a threshold. Evaluate the effect separately from word size so
that a join already rejected on size grounds contributes no apparent extra gain.
