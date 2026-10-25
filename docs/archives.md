# Local comic archives

Archives found in selected directories (`.cbz`, `.zip`, `.cbr`, case insensitive)
are readable albums. Click or press Enter to open one; Right Arrow expands it
without selecting a page. Indexing starts only on opening, with loading/error
text in the tree. Images in internal subdirectories form one album, ordered
naturally by their full normalized paths (`2.png` before `10.png`). Existing
page modes, zoom, overlays, editing and reading history also work in archives.
Page sidecars such as `page.png.en.bbl` (or unambiguous `page.en.bbl`) are
discovered beside images; internal/adjacent album indexes can cover nested paths.
Saved companion sidecars (see the [user guide](../README.md#save-or-discard-your-work)) take precedence over embedded sidecars.
Nested archives and standalone/drag-and-drop import are not implemented.

ZIP/CBZ supports stored and deflated entries using **@zip.js/zip.js 2.24.0**,
`BlobReader`, and browser compression streams. The ZIP is not copied into a
single ArrayBuffer or extracted in advance. CBR uses **libarchive.js 2.0.2**'s
libarchive 3.7.2 WASM decoder. Format signatures and decoder validation determine
the format; suffixes only control discovery. RAR4, RAR5 and a solid RAR5 fixture
are tested. This does not establish support for every RAR variant (particularly
newer RAR7 compression or all solid RAR4 variants).

Archives and extracted content stay in the browser. Decompression runs in a
single disposable worker across all roots, with a 15-second deadline per
operation. Codec assets and their notices are copied from locked dependencies
at install/dev/build time and served from `/comix-sense/codecs/` in production;
no third-party runtime codec fetch or Node browser polyfill is involved. The
existing Carbon stylesheet may request external fonts; these requests contain
no archive payload. Dependency notices are in [third-party notices](../third-party/archive-codecs/README.md).

Fixed initial limits (`src/lib/archives/ArchiveReader.ts`, `src/lib/ImageUrls.ts`):

| Resource                                           |       Limit |
| -------------------------------------------------- | ----------: |
| ZIP input                                          |     512 MiB |
| RAR input                                          |      32 MiB |
| Entries (including ignored metadata/directories)   |      10,000 |
| Declared individual output; actual ZIP output sink |      32 MiB |
| Total declared RAR output per archive              |     128 MiB |
| RAR5 dictionary                                    |      64 MiB |
| Extracted Blob cache, shared across roots          |      64 MiB |
| Archive Blob data held by renderer URLs            |     128 MiB |
| Active decompression                               | 1 operation |

The session Blob cache evicts individual entries, keeping least-recently-used
order within three eviction tiers: thumbnails first, then inactive albums,
then other unprotected entries in active albums. Displayed and incoming spreads
are protected until their image loads are abandoned or their display URLs are
released. If protected entries fill the 64 MiB budget, additional results can
still be displayed without being cached; protection never increases that budget.
Releasing a display URL does not remove an otherwise cached Blob.

Queued reader images and overlays take priority over sidebar thumbnails. A
reader request for an entry already queued as a thumbnail promotes the shared
extraction rather than creating a second job. Running decompression is allowed
to finish; priority does not interrupt a decoder already working. Cancelling
or disconnecting an archive removes its queued jobs and terminates active work.
There is no next-spread prefetch. File fingerprint invalidation and warm WASM
readers remain deferred; decoder workers still have one-operation lifetimes.

The cache and renderer pools together retain at most 192 MiB of encoded output
(excluding decoder working memory, metadata, text/session edits, and browser
image decoding/GPU allocations). Cache eviction drops Blob references; no idle
RAR heap/worker is kept. Offscreen archive thumbnails release their URLs, as do
abandoned page loads and disconnected roots. Incoming and outgoing spreads can
briefly coexist. Very large images can exhaust the renderer budget and fail
with an explicit error. These limits are conservative product limits, not a
sandbox-level cap on a browser process.

Encrypted archives, multipart sets, unsafe paths, normalized duplicate names,
RAR5 unknown output sizes and newer compression versions are unsupported.
Directories, links, `__MACOSX` and `.DS_Store` are ignored as page content. Only
supported raster image types are rendered; archive HTML/SVG is not rendered.
Reported corruption, unsupported compression, empty albums, malformed overlay JSON
and invalid raster data report errors without removing adjacent comics. The known
stored-RAR CRC detection gap below remains unresolved.

## RAR measurements and limits

On local Windows Edge, the bundled real decoder was tested with redistributable
libarchive fixtures (see `../tests/fixtures/archives/README.md`). Each test lists,
reads last → first → last, compares actual output, and terminates every worker.
Representative warm worker operations, including WASM instantiation:

| Fixture             |   Input | Selected output | WASM heap | Warm operation |
| ------------------- | ------: | --------------: | --------: | -------------: |
| RAR4                |   336 B |            20 B |    16 MiB |       19–35 ms |
| RAR5 compressed     |   436 B |         1,200 B |    16 MiB |       19–35 ms |
| Solid RAR5, 7 files | 1,050 B |   last: 4,096 B |    16 MiB |       19–35 ms |

Cold startup varied (roughly 50–400 ms). These tiny fixtures are compatibility
checks, not a large-archive benchmark. Measurements vary by machine and run;
`tests/archives.spec.ts` prints current times and heap sizes.

RAR is **not streaming or constant-time random access** here. It copies the
bounded compressed input into worker memory and then into WASM. The adapter
scans the whole archive for each uncached operation, including files after the
selected one, to validate metadata and encryption. In the solid fixture, the
last-file read skips 21,680 declared bytes from other files; listing traverses
all 25,776 declared bytes. Libarchive's solid-RAR skip implementation decodes
preceding data to rebuild its dictionary. First/last timings are similar here
because both operations traverse all headers and solid data; they do not show
random access. Backward navigation can repeat that cost after cache eviction.
See [libarchive's RAR5 reader](https://github.com/libarchive/libarchive/blob/v3.7.2/libarchive/archive_read_support_format_rar5.c).

The public libarchive.js single-file wrapper was evaluated first. Its entry
loop opens readers without consistently closing them between calls and its
object-based index is inappropriate for untrusted normalized names. The app
therefore calls the pinned decoder's exported functions in a small worker
adapter, validates flat metadata, frees its reader/input, and terminates the
worker after every operation. Only the requested output Blob survives into the
bounded cache; earlier extracted outputs are not accumulated inside a long-lived
WASM heap. This trades startup/scan time for deterministic lifetime cleanup.
**Known corruption issue, deferred:** changing a byte in a stored RAR4 entry can
return the changed payload without reporting its CRC mismatch. The exported
`get_filedata` helper calls the native read once and exposes neither the actual
read length nor a final CRC status. The test named "known libarchive stored-RAR
CRC detection gap (deferred)" is an **expected failure** so this limitation stays
visible and a future fix will require updating the test. Image decoding or JSON
validation may reject damaged content, but this is not archive-integrity verification.

The browser-only in-memory API of node-unrar-js 2.0.2 was also evaluated in the
same disposable worker. It passed the fixture/backward-reading checks and rejected
the changed stored payload. This release retains libarchive.js; investigating
its corruption handling and reconsidering that alternative are follow-up work.
node-unrar-js and its filesystem API are not included in the application.

Libarchive's `get_filedata` helper allocates output internally from the declared
size and does not expose a streaming byte limiter or the actual read length.
Metadata limits, dictionary checks, the conservative input limit and terminating
the worker after 15 seconds reduce exposure but **do not enforce a hard bound
on decoder heap growth or prove arbitrary malformed RAR output sizes**. ZIP
also validates actual decompressed size and the app counts bytes at its output
sink; forged small metadata is covered by a real decompression test. No claim
of unrestricted large-archive support is made.

To validate the production worker and WASM paths after building:

```powershell
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173
# In a second terminal:
$env:TEST_BASE_URL='http://127.0.0.1:4173/comix-sense/'
npx playwright test tests/archives.spec.ts --workers=1
```

The development suite additionally tests real-decoder cache eviction,
deduplication, cancellation, and worker termination through the reader adapter.
Production tests exercise the same emitted worker/WASM through archive selection,
restoration, editing, independent roots and disconnect-during-indexing behavior.
