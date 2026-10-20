# Comix Sense

A local comic reader and speech-bubble overlay editor, built with Svelte 5 and SvelteKit.

## Using the app

Open the app in Chrome or Edge, choose **Select directory...**, expand a folder in the sidebar, and select a page. Supported image extensions are BMP, GIF, JPG, JPEG, PNG, and WebP. The browser reads files from the selected directory; no server upload is involved.

Choose **ORG** to see the original page, or select a language to show its speech-bubble overlays. For `page01.png`, the English overlay is `page01.en.bbl`. Each `.bbl` file is JSON containing `pages[0].bubbles`, for example:

```json
{
	"pages": [
		{
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
				}
			]
		}
	]
}
```

Enable **EDIT: YES** to edit text or drag a bubble's handles. For a new box, click two opposite corners. For a polygon, click its vertices and then click near the first vertex to close it. Escape cancels a drawing; Backspace removes the last vertex or cancels a box. Right-click bubble text to convert its shape or delete it. The zoom menu supports fit, width, and percentage scales.

Edits to language overlays are retained while switching pages in the current session. **Saving/exporting is not implemented**, so reloading the app loses edits. The scan/OCR actions and drag-and-drop import are still placeholders; automatic translation is not implemented.

## Developing

Use Node.js 22.12 or newer in the 22.x series, or Node.js 24 or newer:

```bash
npm ci
npm run dev
```

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

The static site is generated in `build/` and served under `/comix-sense/` in production. The GitHub Pages workflow runs type checks and browser tests before building and deploying.

To run the same browser tests against a running preview or another checkout, set `TEST_BASE_URL` to its full URL, including the trailing slash (for example, `http://localhost:4173/comix-sense/`).
