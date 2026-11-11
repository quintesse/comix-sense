# Offline vision replay

These developer tools compare the existing OCR grouping and translation preparation
with recorded image-assisted responses. They also replay source-only grouping into
an ordinary editable `.MRG.bbl` album. They are separate from the reader's AI controls.
There is no provider transport, credential lookup, live command, or production opt-in.
All included artwork and responses are invented synthetic examples; no comic scans
or private recordings are included.

## Setup and synthetic rehearsal

Use the Node version and `npm ci` setup in [Development](development.md).
Rendering uses installed Edge on Windows, or Playwright Chromium elsewhere
(`npx playwright install chromium`). The tool bundles the existing `ComicBubble`
component and checks generated BBL files with the production parser.

```sh
npm run test:vision-pilot
npm run rehearse:vision-pilot -- EXISTING_OUTPUT_DIRECTORY
```

Use an existing directory outside the checkout, or an ignored directory under
`comics/`. Every preparation and replay creates a fresh `synthetic-*` or `attempt-*`
subdirectory. Files use exclusive creation; source pages and existing sidecars
are never overwritten. Rehearsal generates its own SVG and PNG artwork, OCR BBL,
manifest, and recorded JSON. It exercises a successful paired export, rejection
of an omitted OCR ID, and a simulated budget refusal before recorded dispatch.
Tests also exercise source-only export, complete token accounting, filtering,
fonts, fitting, and comparison controls.

For a generic read-only gallery of already generated images, its manifest format,
and a clearly qualified record of the historical vision findings, see
[Offline visual review tooling and research record](vision-review-tooling.md).

Open the successful attempt's `index.html` for the paired review. Each comparison
shows the original and rendered page, with independent fitting-space, selected-layout,
and original-size controls. Reports keep the A/B method key separately. The
`overlays/baseline/` and `overlays/vision/` albums contain copied artwork and target
language BBL files. `review-template.json` is an unfilled human review form.

## Paired replay

```sh
npm run replay:vision-pilot -- --manifest MANIFEST.json --recordings RECORDINGS.json --output EXISTING_OUTPUT_DIRECTORY
```

Use the generated rehearsal manifest and recordings as the format example.
A schema-version-1 manifest provides explicit distinct source and target languages,
page IDs, image and word-level OCR paths (relative to the manifest), pixel dimensions,
per-method request limits, and simulated rates and cap. Optional input SHA-256 values
freeze the image and OCR files. `responseContract` selects full token accounting (1)
or compact ordered tokens (2); it defaults to 1. New prompt revisions are explicit,
so the source and vision prompt contracts retain their older forms. Baseline preparation
always uses the current production cleanup rules: recordings from an earlier
baseline revision can fail schema or ID validation after filtering changes. The
implementation hashes in the report identify the replay version. Optional glossary, font, mask style,
and verified local typography declarations affect only this offline output.

Recordings are an object keyed by `PAGE_ID:baseline` and `PAGE_ID:vision`.
Each record contains `finishReason: "stop"`, usage counts, and `value` matching its
request's contract. Timeout and incomplete response records are rejected. Baseline
responses use the production cleanup schema. Vision responses must account for
every OCR ID exactly once, either in ordered passages or in reasoned false-detection
exclusions. Corrections identify the affected OCR record; missing words require a
bounded positive page region. Full contract examples are in `core.test.mjs`;
compact examples and negative cases are there too.

The report records input and implementation hashes, rendering diagnostics, local
recorded dispatch count, zero network dispatches, and separately scoped simulated
costs. Simulated reservations and usage are test evidence, not real provider charges
or a current pricing recommendation. A failed replay exits with code 2 and retains
its report and raw recorded evidence.

## Source-only replay and export

```sh
npm run source:vision-pilot -- prepare IMAGE OCR.bbl SOURCE_LANGUAGE WIDTH HEIGHT EXISTING_OUTPUT_DIRECTORY
npm run source:vision-pilot -- replay PREPARED/manifest.json RECORDINGS.json EXISTING_OUTPUT_DIRECTORY
```

Preparation requires the actual original language and exact pixel dimensions. It
writes input hashes and a source request without transmitting anything. Its manifest
uses absolute input paths, so keep those inputs in place for replay. A source recording
is keyed by `page:source`, for example:

```json
{
	"page:source": {
		"finishReason": "stop",
		"value": {
			"sourceLanguage": "en",
			"passages": [{ "tokens": ["w0000", "w0001"] }],
			"exclusions": []
		}
	}
}
```

OCR IDs follow input array order (`w0000`, `w0001`, ...), including empty records.
Use a string ID for an unchanged word, `{ "id": "w0000", "text": "corrected reading" }`
for a correction, or `{ "text": "missing word", "region": { "type": "box",
"vs": [{ "x": 10, "y": 20 }, { "x": 40, "y": 50 }] } }` for a word recovered
from the image. Exclusions require both `id` and a nonempty `reason`. Passage order
is the proposed reading order. Structural validation checks complete accounting,
languages, schema, and geometry; it cannot verify what the image actually says.

Successful replay writes `album/` with byte-identical artwork and OCR copies plus a
source-language `.MRG.bbl`, full `passage-token-mapping.json`, comparison HTML,
PNG, fitter candidate ledger, and `report.json`. Complete passages consisting only
of Unicode numbers, punctuation, and whitespace retain their token mapping but
produce no overlay. Numbers inside prose and symbols such as currency signs remain.
An all-skipped page still exports a valid empty overlay. Source replay rechecks frozen
input hashes; it never updates originals. Optional album fonts must already exist
locally or in the explicit offline font cache; rendering does not fetch fonts.

## Review limits

Recorded grouping and translations, including correction and exclusion decisions,
are supplied evidence rather than newly generated model results. Reports do not
count them as automatic visual correctness or approved edits. Review source fidelity,
reading order, omitted lettering, translation, font size, overflow, and covered artwork
before using any export. The mask is a convex hull of accounted word shapes and
bounded missing-word regions; it can cover artwork between words. Fitting stays in
that mask and can shrink text. These tools do not include experimental balloon
interior detection, connected-balloon review, erasure, or color adjustment.

Synthetic success verifies local replay/export plumbing and preservation checks;
it does not establish grouping quality or translation quality on genuine pages.

## Source evidence diagnostics

Source preparation also writes `source-request.json` and `freeze.json`, sealing hashes
for the manifest, request, image, and OCR input. Replay checks the seal and requires
the reconstructed request to match it. Legacy preparations without a freeze remain
replayable using the manifest's image and OCR hashes.

Use `npm run diagnose:vision-pilot-source -- MANIFEST RESULT_DIRECTORY OUTPUT_PARENT`
to create a read-only HTML and JSON projection of raw memberships, exclusions, and
coverage. An adjacent `freeze.json` is discovered automatically; an explicit form is
`MANIFEST FREEZE RESULT_DIRECTORY OUTPUT_PARENT`. Diagnostics retain the saved report
status and structural-validation result, and never repair or approve a response.
They embed original artwork and OCR text, so treat the output as private evidence.
The offline tests include synthetic rejected responses and tampering checks; they do
not establish grouping quality on genuine pages.

The human-reviewed page 20 membership regression can be scored offline with
`node tools/vision-pilot/source-page20-regression.mjs REQUEST_JSON RESPONSE_JSON`.
It requires the reviewed OCR fingerprint, reports the independent grouping,
coverage, and uniqueness checks, and does not feed results into replay. Exit code 0
means the reviewed expectations pass, 1 means the score fails, and 2 means the
inputs or command are invalid. Its exact page-specific expectations are regression
fixtures only, never production decisions.
