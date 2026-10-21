# Geometry-only balloon grouping

Run from the repository root:

```powershell
jbang tools/bubblemerge.java --output=merged.bbl --report=review.json tools/SW-A070-P09-ocr.bbl
jbang tools/bubblemerge_test.java
```

The input is word-level BBL, including punctuation entries. The tool reads stdin
when no input path is provided and writes UTF-8 JSON to stdout unless `--output`
is specified. Output and report files must be new. It does not modify the input.
This is a separate experimental tool; `wordmerge.java` retains its existing
explicit horizontal-gap behaviour.

Stderr also prints file-wide median original word-box height and median line
advance, in image pixels. Height uses all positive-height original entries,
including punctuation, before merging. Line advance pools positive distances
between consecutive reconstructed row centres within each output group; it
never measures between different groups or pages, and same-row fragments count
as one row. Measurements are pooled across all pages before taking each median,
not averaged from per-bubble or per-page medians. Missing measurements print
`n/a`. These are rough OCR diagnostics only; they add no fields to the output
BBL or review report.

## Approach

The old `groupWords` implementation uses a margin of 0.75 times word height and
requires contact with an actual member word as well as the group rectangle.
That is useful protection against merging through an empty corner of a large
rectangle. However, proximity chains can still join two neighbouring balloons.

The new tool uses a hierarchy:

1. Estimate rows from median word heights and vertical centres. Compare each
   incoming word with a row's median, avoiding unrestricted transitive drift.
   Process lexical words before punctuation. Small punctuation can attach to
   an actual nearby word even when its height differs greatly.
2. Within a row, form horizontal runs. A gap greater than 0.65 times median
   height starts another run. Language and style differences also separate runs.
3. Look for a neighbouring row with two separated runs. It supplies evidence
   that a continuous-looking row above or below may actually cross a balloon
   boundary. Choose a nearby word boundary using gap width and distance from
   the neighbouring gutter. Only original runs supply evidence, so inferred
   splits cannot recursively manufacture more evidence.
4. Connect adjacent lines using vertical spacing, horizontal overlap, similar
   text height, and left/right/centre alignment. Each line chooses its best
   predecessor and successor. Connect mutual choices, preventing a single line
   from indiscriminately joining several nearby columns.
5. Allow two separated fragments of a row to join the same continuous line
   when both choose that line and both lie within its horizontal span, allowing
   half a text height of edge variation. This handles text wrapping around art.

All distances are proportional to local text height. There are no page-specific
coordinates, Dutch vocabulary, image features, or OCR input-order assumptions.
The factors are heuristic defaults, developed against this sample; they are not
learned parameters or calibrated probabilities.

## Ambiguity and scope

Neighbouring-row split evidence requires a gutter between 0.9 and 3 text heights
wide, a row distance between 0.6 and 1.65 heights, and a candidate word boundary
within 1.5 heights of the gutter edges. Wider empty areas may be internal artwork
and do not trigger this inference. This is a tradeoff: some real adjacent balloons
will remain joined, while some irregular layouts could still split incorrectly.

Line continuation allows box overlap up to half a text height and whitespace
up to 0.65 heights. It accepts height ratios up to 1.9 and requires some horizontal
overlap. Large isolated punctuation therefore usually stays separate. Rotated
text, vertical scripts, unusually loose lettering, nested balloons, and mixed
font sizes need more examples before extending the rules. Identical geometric
layouts can represent different balloon boundaries; OCR boxes cannot resolve
all such cases.

The report records every output group's zero-based source indexes and the
boundaries inferred from neighbouring gutters. These decisions need review on
new pages; absence of an inferred split does not imply certainty.

Text reads left-to-right within each row, with newlines between rows. Closing
punctuation joins the preceding token, opening punctuation joins the next, and
standalone hyphens join the preceding token. Word spelling and OCR mistakes are
preserved; line-end hyphens are not automatically dehyphenated. Cross-balloon
ordering uses approximate horizontal bands, not panel detection. For example,
the lower balloon in a panel can appear after a higher balloon in the next panel.

Each group uses a simplified orthogonal outline of its row fragments. Edges
within 0.25 times median line height are homogenized outward: left/top edges
take the minimum, right/bottom edges take the maximum. Clusters have bounded
total spread, so a chain of small differences cannot flatten a large step.
Overlapping row fragments meet halfway across small vertical gaps. The union
retains significant steps and open cut-ins around artwork, including Sidonia's
head. Collinear vertices are removed, and rectangular results use `box`.
These are text envelopes, not traced balloon borders; every word box remains
inside. There is no extra padding beyond outward homogenization and line joins.
BBL has no holes or multiple contours: enclosed holes are filled; disconnected
components conservatively fall back to the enclosing box. Singletons retain
their original shape.
The earliest input member supplies other metadata. Singletons retain their
original shape. Pages and document metadata are preserved. Run on original OCR
words, not on previously merged output; repeated merging is not an intended
operation. Runtime is suited to page-sized inputs: neighbour-run split search
is cubic in the number of initial runs in the worst case.

## Sample validation

`SW-A070-P09-ocr.bbl` has 212 OCR entries. The result has 18 regions: 16 dialogue
balloons, one narration caption, and the standalone question mark. Membership
was visually checked against the supplied `09 ßalou.jpg`; the expected index
sets are in `SW-A070-P09-groups.json`. The algorithm never reads that image or
the expected-group file.

The two inferred boundaries are after source index 6 (the hyphen before
“Lieve”) and after index 113 (“hier”, before “Sidonia”). The image also confirms
that the widely separated “niet / Oplossen” and “vit / dan” fragments belong to
one balloon, which wraps around Sidonia's head. OCR errors and extra punctuation
are intentionally retained.

Tests check exact group membership, preservation of every source index exactly
once, enclosing geometry, metadata, page isolation, punctuation, nearby balloons,
irregular rows, and large isolated punctuation. Shape tests check whole word-box
containment, outward homogenization, retained steps and the head cut-in, and
absence of zero-length or redundant collinear edges. They also check identical text
grouping after input shuffling, translation of coordinates, and scaling by 0.25
and 4. This verifies the sample and synthetic cases, not accuracy across a comic
collection. More independently labelled pages should precede production tuning.
