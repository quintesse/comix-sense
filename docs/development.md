# Development and tools

Comix Sense uses Svelte 5, SvelteKit, and a static build. Run commands from the repository root.

## Developing

Use Node.js 22.17 or newer in the 22.x series, or Node.js 24 or newer:

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite in Chrome or Edge.

### Optional Google Vision key

You can set `GOOGLE_VISION_KEY` in the environment or a local `.env` file before
starting development or building. It takes precedence over the key entered in
OCR Settings. Restart the development server or rebuild after changing it.
This static app includes the key in its client bundle, so use an appropriately
restricted browser API key. Setting it only when serving an existing build does
not change that build.

## Validation

```bash
npm run check
npx playwright install chromium
npm test
npm run build
```

Browser tests use deterministic local files through a simulated directory picker, exercising the actual reader and editor. On Windows they use installed Microsoft Edge by default; set `PLAYWRIGHT_CHANNEL=chromium` to use Playwright's Chromium instead. On Linux, CI installs Chromium with `npx playwright install --with-deps chromium`.

## Building

```bash
npm run build
npm run preview
```

The static site is generated in `build/` and served under `/comix-sense/` in production.
The GitHub Pages workflow checks formatting and types and builds the site first, then
runs the full browser suite across two parallel jobs. Each browser job uses the official
Playwright container matching the exact version in `package-lock.json`, with browsers
and system dependencies already installed. Test reports and failure traces are uploaded
as separate artifacts for each shard and retained for seven days. Superseded PR runs
are cancelled. Deployment uses the checked build artifact only after both shards pass,
and only for pushes to `main` or manual runs on `main`.

To run the same browser tests against a running preview or another checkout, set `TEST_BASE_URL` to its full URL, including the trailing slash (for example, `http://localhost:4173/comix-sense/`).

## Extract bubble text

To extract the same cleanup JSON from a `.bbl` file without calling a provider:

```sh
jbang tools/bubbletext.java album.en.bbl > cleanup.json
```

The script prints only `sourceLanguage`, `targetLanguage`, and the ordered `items`
with bubble paths and text, including empty strings. Page indexes start at zero
within the supplied file. Conventional language suffixes take precedence over
the document's `lang`; OCR uses bubble language metadata, or `und` when ambiguous.
Without a language suffix, the document's `lang` is used, falling back to bubble
language metadata. Both dot and hyphen suffixes are supported. The input file is never modified.

Supply an optional second argument to extract paired source and translated text:

```sh
jbang tools/bubbletext.java SW-A070-P09-mrg.bbl en
jbang tools/bubbletext.java album.nl.bbl translations/album.en.bbl
```

A language code replaces the first file's suffix in the same folder (for example,
`SW-A070-P09-mrg.bbl` becomes `SW-A070-P09-en.bbl`). A file without a suffix gets
`.CODE` before `.bbl`. Otherwise, the argument is a file path, relative to the
current working directory or absolute. The files must have the same page count
and the same bubble count on each page; bubbles are paired by index. In this mode,
`targetLanguage` comes from the second file, and each item contains `id`, `source`,
and `target` instead of `id` and `text`. Items with exactly identical source and
target text (including two empty strings) are omitted; remaining IDs retain their
original page and bubble indexes. Neither file is modified.
