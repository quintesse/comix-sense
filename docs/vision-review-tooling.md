# Offline visual review tooling and research record

The development-only review tools compare saved images and geometry without changing
reader behavior. They make existing evidence easier to inspect; they do not run OCR,
translation, grouping, fitting, erasure, or model inference. No private comic images,
recordings, or generated reviews ship with the repository.

## Saved-artifact gallery

Use the gallery when an experiment has already produced comparable images. It accepts
explicit input paths, embeds the images in a standalone HTML file, and creates a fresh
`attempt-*` output directory so an earlier review cannot be overwritten.

```sh
npm run review:vision-artifacts -- MANIFEST.json EXISTING_OUTPUT_DIRECTORY
```

The output directory must already exist outside the checkout, or be an ignored directory
under `comics/`. The command writes only `index.html` and `report.json` in its new attempt.
The report records SHA-256 hashes of the manifest and every image. The command rechecks
those hashes after generation. It makes no network requests and does not download assets.

The manifest format is:

```json
{
	"schemaVersion": 1,
	"title": "Saved erasure comparison",
	"pages": [
		{
			"id": "page-a",
			"label": "Page A",
			"width": 1200,
			"height": 1600,
			"note": "Saved automatic result; not manually corrected.",
			"variants": [
				{ "id": "original", "label": "Original", "image": "page-a-original.png" },
				{ "id": "candidate", "label": "Saved candidate", "image": "page-a-candidate.png" }
			],
			"passages": [
				{
					"id": "p1",
					"label": "Passage 1",
					"view": [100, 200, 300, 180],
					"note": "Automatic output with a human-selected review crop.",
					"provenance": "automatic-output/manual-crop"
				}
			]
		}
	]
}
```

Image paths are relative to the manifest unless absolute. PNG, JPEG, WebP, and SVG are
accepted. Every page needs at least two variants with the declared pixel dimensions.
Passage crops are optional and must stay within those dimensions. The viewer provides
page and crop selectors plus an original-pixel-size control. Labels, notes, and provenance
are review metadata, not correctness claims.

Run the entirely invented demonstration with:

```sh
npm run rehearse:vision-pilot -- EXISTING_OUTPUT_DIRECTORY
```

The JSON result names `savedArtifactReview.review`. Open that HTML file and select the
synthetic speech crop to exercise the gallery without private data or paid calls.

## Existing comparison viewer

The replay tools described in [Offline vision replay](vision-pilot.md) generate paired
original/rendered comparisons. Their fitting-space, selected-layout, and original-size
controls remain the preferred view when saved fitter ledgers are available. To rebuild
only the presentation from a saved source attempt, provide a new output filename:

```sh
node tools/vision-pilot/comparison.mjs SAVED_SOURCE_ATTEMPT NEW_COMPARISON.html
```

This reads the saved HTML, review PNG, and fitter-space ledger. It does not recalculate
geometry, and it refuses to overwrite the destination. It intentionally does not fall
back to experimental artwork-interior detection when a ledger is absent.

## Research findings retained from the vision checkout

The source checkout contained useful reports, but most referenced a private development
album and uncommitted generated files that are unavailable in a fresh checkout. The
following is therefore a research record, not reproduction of those private results:

- A historical page-20 manual-contour comparison reported larger connected-line type in
  selected passages. The contours were human-authored and the fitter is a later merge-plan
  item, so this is manual-assisted historical evidence, not current automatic behavior.
- A historical automatic connected-line review reported 11 of 16 page-20 passages using
  detected bands, with seven gaining font size. A three-page development run reported 28
  of 69 groups accepted and 25 larger fonts. OCR membership on those extra pages was not
  fully reviewed. These measurements were not rerun here and do not establish quality on
  an independent album.
- Historical erasure comparisons recorded improvements and failures, including lost face
  or hand detail, clipped artwork, leftover lettering, and false-OCR patches. Some later
  examples used manual token splits, manual mask choices, or restored-art inputs. Those
  corrections must remain separate from automatic results.
- A saved-artwork-loss ranking was useful as a review queue but missed clear losses among
  unflagged passages. An absent warning was not a safety guarantee. The scorer and erasure
  generator belong to later evaluation items and are not available through this tooling.
- The first paid pilot and later replay evidence did not demonstrate a zero-edit album or
  the stated cost goal. Recorded responses are supplied evidence; synthetic replay verifies
  plumbing only. Conclusions about general grouping, translation, fitting, or erasure
  quality remain unproven.

The detailed private visual references, OCR, model responses, manual decisions, and
generated HTML/PNG artifacts remain only in the source investigation workspace. Their
repository-relative `comics/vision-pilot/...` references do not resolve in a fresh clone
and are deliberately not presented as shipped evidence.

## Scope and limitations

The gallery trusts that images actually correspond to their labels and dimensions; it
does not verify pixels semantically. Crop selection and provenance descriptions can be
manual. Browser rendering is a presentation check, not an evaluation of the underlying
algorithm. Keep generated reviews outside version control because standalone HTML embeds
the input images and can therefore contain private artwork.

Connected-line fitting, artwork-interior detection, multi-page layout generation,
artwork-loss scoring, pixel-level erasure, restoration, and live inference are deliberately
not exposed by these commands. Review their saved outputs with the gallery when available,
or implement their separately specified merge-plan item before claiming reproducibility.
