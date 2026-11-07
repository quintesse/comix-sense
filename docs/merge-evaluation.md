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
