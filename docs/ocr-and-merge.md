# OCR and bubble merging

OCR finds text on a page; Merge turns those separate words into editable
passages. This guide explains how Merge makes its decisions and what its tuning
values mean. For exact conditions and implementation details, see
[the merge code](../src/lib/mergeBubbles.ts).

For the app workflow, see [Scan a page or album](../README.md#scan-a-page-or-album).
For storage and typography, see [the BBL format](bbl-format.md).

## From page image to editable text

**Scan Full Page** sends the original page image to Google Cloud Vision. This
transfers image data from the browser to Google and can incur provider charges.
The returned words become bubbles in the page's OCR overlay, preserving their
text and shapes. Rotated or irregular shapes remain polygons. The detected
source language is stored separately from the overlay name, **OCR**.

With **Automatically merge bubbles** checked, the app then combines those words
into passages. Uncheck it to keep the individual OCR results, including their
original whitespace and number-only or symbol-only entries. Raw OCR uses a
no-wrap setting so narrow word shapes do not force wrapping; Merge removes that
page-level setting so the combined text can flow within its shape.

The **Merge** button in Edit Mode runs the same merging process on the current
page's OCR overlay. It works locally, without another recognition request, and
updates OCR even if a translation is currently selected. Each page is processed
independently.

Scan and Merge stage editable changes and schedule a browser backup. They do
not save `.bbl` files to disk: use **Save Changes** or **Save All** for that.
**Discard Changes** restores saved data. Before scanning over existing OCR, the
app asks for confirmation; if an album scan fails partway through, completed
pages remain available.

## What Merge can infer

Imagine two speech balloons side by side, each containing several lines. Words
at roughly the same height initially look like one long row. Spaces separate
that row into shorter stretches, and the lines above or below help determine
which stretches belong to each balloon.

Merge follows this idea: find rows, separate neighboring passages, connect lines,
then assemble text and an enclosing shape. It uses word positions and sizes,
not the artwork. It cannot see balloon borders, detect speakers, translate, or
correct spelling. A plausible-looking group is still a geometric guess.

Words with different language or style values stay separate. Explicitly
positioned text layouts also stay separate. Font differences alone do not
prevent merging; the earliest input member supplies the group's metadata.

### Understanding the tuning values

Most distances are measured relative to nearby text height rather than in fixed
pixels. For example, a gap allowance of 65% of a 20-pixel text height is
13 pixels. Scaling the page therefore scales the allowance too.

A row's typical height is the median of its word heights. This reduces the
influence of an unusually tall word. Different stages use different reference
heights, described below; there is no single page-wide font size.

These values are constants in the code, not app settings or confidence scores.
The tuning notes describe their local effect with other rules unchanged. More
permissive grouping can recover a fragmented passage but can also combine
neighboring balloons. Stricter grouping makes the opposite tradeoff. Changes
can interact, so a single adjustment does not guarantee a particular final result.

## Finding words on the same row

Words form a provisional row when their heights are similar and their vertical
centers are close. Horizontal distance is left for the next stage, so this row
can initially extend across more than one balloon.

Letters and numbers establish rows before punctuation. A small comma should
attach to a nearby word, rather than determine the height of a new row. Row
height and center are updated as words join, using medians to avoid letting one
oddly shaped word dominate.

| Tuning value                  | What it means                                                                                                                   | Effect of increasing it                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 55% minimum height ratio      | The shorter of the incoming word and typical row height must be at least this fraction of the taller.                           | Requires more similar sizes; decreasing it admits more mixed-size text.          |
| 42% vertical-center allowance | Centers may differ by this fraction of the taller height.                                                                       | Accepts more uneven placement, but risks combining separate text rows.           |
| 35% punctuation reach         | A small punctuation mark can attach within this fraction of a nearby word's height, if their boxes touch or overlap vertically. | Recovers more distant punctuation, but risks taking a mark from another passage. |

For example, a 20-pixel word and a 16-pixel row are similar enough in size.
Their centers can differ by up to 8.4 pixels. A much smaller comma can still join
through the punctuation rule.

## Separating neighboring passages

### Break at large horizontal spaces

Within each provisional row, Merge reads left to right and starts a new **run**
when the gap exceeds **65% of the row's typical word height**. A run is simply a
stretch of words close enough to look like one line of text.

Raising this cutoff keeps more widely spaced words together but can join nearby
balloons. Lowering it separates balloons more readily but can break a sentence
into fragments. Later stages can reconnect some of those fragments.

### Use nearby rows to resolve ambiguous gaps

Two balloons may nearly touch on their widest text row while leaving a clear
gap on the row above. That clearer separation suggests a **gutter** between
passages. Merge uses it to find a plausible word boundary in the ambiguous row.

The evidence must be local: two roughly aligned runs, separated by a substantial
but not enormous gap, on a nearby row. Inferred cuts do not become evidence for
further cuts, which limits cascading mistakes.

The following distances use the height of the line being considered for a cut.

| Tuning value                                               | What it means and how changing it affects the decision                                                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gutter width: 0.9–3 text heights                           | A smaller minimum accepts less convincing gaps; a larger maximum accepts evidence from more distant passages. Narrowing the range demands more specific evidence.                                                                       |
| Evidence-row alignment: 40% of text height                 | The two evidence runs must be approximately level. Increasing this allows more staggered runs.                                                                                                                                          |
| Distance to evidence row: 0.6–1.65 text heights            | Evidence should come from a different but nearby row. Lowering the minimum admits nearly same-row evidence; raising the maximum allows more distant rows to influence the cut.                                                          |
| Search allowance: 1.5 text heights beyond the gutter edges | The cut can shift sideways from the apparent gutter, while remaining between the evidence runs' centers. Increasing this permits larger shifts.                                                                                         |
| Word-box overlap allowance: 25% of text height             | Slight overlap is tolerated because OCR boxes can be imperfect. Increasing the allowance permits cuts between more heavily overlapping boxes.                                                                                           |
| Distance penalty: 0.08                                     | Wider word gaps are preferred, with a small penalty for distance from the gutter center. Moving 10 pixels farther away costs 0.8 pixels of gap advantage. Increasing this weight favors centered cuts; decreasing it favors wider gaps. |

These checks locate plausible cuts; the score chooses among them. It is not a
confidence test. If an evidence pair finds an eligible boundary, it proposes a
cut even when the score is negative.

## Connecting lines into a passage

The next question is whether one line continues into another below it. Lines
must have reasonably similar text sizes, plausible vertical spacing, and some
horizontal overlap. They can align along the left edge, center, or right edge,
which accommodates both centered balloon text and edge-aligned passages.

The smaller line height is the reference here: a large heading should not grant
a very generous spacing allowance to a small neighboring line.

| Tuning value                                   | What it means                                                                                                                   | Effect of increasing it                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Maximum height ratio: 1.9                      | The taller line can be up to 1.9 times the shorter.                                                                             | Allows more mixed-size lines to connect.                                                 |
| Minimum center separation: 65% of text height  | The next line must be meaningfully below this one.                                                                              | Rejects more tightly stacked lines; decreasing it can connect nearly same-row fragments. |
| Vertical overlap allowance: 50% of text height | Line boxes may overlap vertically by up to half the smaller height.                                                             | Tolerates more overlapping boxes.                                                        |
| Maximum blank gap: 65% of text height          | Limits empty space between the upper and lower boxes.                                                                           | Connects more widely spaced lines, but risks crossing between passages.                  |
| Alignment allowance: 2 text heights            | At least one of the left edges, centers, or right edges must be this close.                                                     | Allows more sideways drift, though horizontal overlap is still required.                 |
| Alignment weight: 0.2                          | Vertical closeness dominates the choice: one height of alignment mismatch costs as much as 0.2 heights of blank vertical space. | Favors alignment more strongly; decreasing it favors vertical closeness.                 |

Each line chooses its best continuation below and its best predecessor above.
**Lines normally join only when they choose each other.** This keeps one wide
line from automatically absorbing every nearby column. Chains of mutual choices
form a group.

There is one useful exception. A lower row may be split into two fragments by
artwork or unusually wide spacing. If both fragments prefer the same upper line,
and that upper line mutually chooses one of them, the other can join too when
both fit beneath it. Their centers must be within **40% of the upper line's
height**, and each may overhang it by up to **half that height** on either side.
Increasing these allowances admits more staggered or wider fragments, at the
risk of pulling in neighboring text. Merge does not inspect what caused the gap.

## Putting the text in reading order

Groups are ordered in approximate left-to-right reading bands. Groups beginning
within **half a typical first-line height** of the highest remaining group are
read from left to right, then the process moves down the page. Increasing that
half-height allowance gives left-to-right position more influence across uneven
starts; decreasing it favors top-to-bottom order. It does not change membership.

Within a group, Merge finds rows again and reads words from left to right. This
lets fragments that now belong to the same passage become one text row. It
reconstructs ordinary punctuation spacing: `Hello`, `,`, `world`, `!` becomes
`Hello, world!`.

OCR line wrapping is removed so the result can flow within its editable shape.
Hyphens at line breaks are kept and joined to the following text: `well-` at the
end of one row followed by `known` becomes `well-known`. This is whitespace
cleanup, not spelling correction or linguistic dehyphenation.

Finally, the OCR merge operation removes groups containing no Unicode letters.
Numbers and punctuation survive when attached to text, such as `Room 123` or
`Hello!`, but standalone `123` or `?!` disappears. This happens after grouping
so useful punctuation and numbers have a chance to join a passage.

## Drawing the merged shape

Picture a rectangle around each geometric line. Merge smooths small differences
between their edges, fills small vertical gaps, and combines them into one
outline. A short first line above longer lines can produce a stepped shape.
This follows the text's footprint, not the drawn balloon.

Two values control this stage:

- **Edge smoothing: 25% of the group's typical line height.** Nearby edges move
  outward to line up. At a 20-pixel height, left edges at 100 and 104 pixels both
  move to 100. Increasing the tolerance flattens larger differences and expands
  the shape more; decreasing it retains more small steps.
- **Vertical bridging: 65% of the smaller line height.** Horizontally overlapping
  rectangles can extend to meet halfway across a gap of this size. Increasing
  the limit bridges larger gaps; decreasing it leaves more disconnected pieces.
  This is separate from the similarly named spacing limit used to connect lines.

The combined outline fills enclosed holes. If separate pieces remain, Merge
falls back to one enclosing rectangle. A word that never joins another retains
its exact original shape, including any rotation.

These adjustments only shape an already chosen group. They do not draw more
words into it. The output is independently editable, and its other metadata
comes from the earliest original input member.

## Limits and implementation references

Merge favors horizontal, left-to-right text. It does not detect panels, so it
can read a high balloon in the next panel before a lower one in the current
panel. Vertical scripts, right-to-left text, rotation, unusual spacing, and
neighboring balloons with similar geometry can confuse it. Polygon inputs are
accepted, but grouping uses their horizontal and vertical bounds.

Merge works best on original word-level OCR. Running it again on an already
merged overlay treats each previous passage as one input and can change the
result; it cannot recover the original word positions. Rescan with automatic
merging unchecked to recover word-level inputs.

The code is the reference for exact comparisons, tie-breaking, metadata rules,
and shape construction:

- [Geometric merge implementation](../src/lib/mergeBubbles.ts)
- [OCR adapter and final text filter](../src/lib/ocr.ts)
- [Scan/Merge UI and staging](../src/routes/+page.svelte)
- [OCR and merge tests](../tests/ocr.spec.ts)
- [Workspace and scan integration tests](../tests/bbl-workspace.spec.ts)

The [Java helper](../tools/bubblemerge.md) provides related geometry and review
reporting, but its text formatting and punctuation retention differ from the
app's full OCR pipeline.
