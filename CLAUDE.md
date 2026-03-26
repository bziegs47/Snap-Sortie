# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

```bash
npm run dev        # start Electron with hot-reload via electron-vite
npm run build      # production build to out/
npm run typecheck  # tsc --noEmit (no separate tsconfig needed beyond defaults)
```

**Note:** Main process changes (`src/main/`, `src/preload/`) require a full dev server restart. Kill the Electron process with `pkill -f "Electron.app/Contents/MacOS/Electron"` before restarting. Renderer changes are picked up by HMR automatically.

## Architecture

Snap Sortie is an Electron app using the standard two-process model:

**Main process** (`src/main/`) runs Node.js. It owns all file I/O, API calls, and the organizer pipeline. IPC handlers are registered in `src/main/index.ts` via `ipcMain.handle`.

**Renderer process** (`src/renderer/`) is a React SPA with three tabs: Organize, History, Settings. It has no direct Node access — everything goes through the preload bridge.

**Preload** (`src/preload/index.ts`) exposes a typed `window.api` object using `contextBridge`. Every method is a thin `ipcRenderer.invoke` wrapper. The renderer calls `window.api.*`; the main process handles the corresponding `ipcMain.handle` channel.

### UI structure

- **Organize tab** — Split layout: drop zone pinned at top (always visible), scrollable session results pane below. After files are dropped/browsed, a **pre-sort staging prompt** appears showing file count, filenames, and a per-sort exclusion input before sorting begins. Files with "Unknown" or "Other" classifications show inline review controls (pencil icon to edit path, checkmark to accept). A "N files need review" banner appears in the session header when unknowns exist; clicking it scrolls to top and opens the bulk ReviewPanel.
- **History tab** — All-time history persisted in `localStorage` (key: `snapsortie-history`, max 2000 entries). Grouped by day. Searchable by filename, path, location, or category. "Clear all history" button wipes localStorage only (does not affect files on disk).
- **Settings tab** — Output folder, Anthropic API key, excluded terms.

### Service pipeline

Files are routed by extension in `organizeFile()` in `organizer.ts`:
- `.pdf` → `organizeDocument()` in `document-organizer.ts`
- `.jpg/.jpeg/.png/.heic/.heif/.tif/.tiff/.webp` → `organizePhoto()`

**Photo pipeline** — `organizePhoto()` runs these steps in order:

1. **`exif.ts`** — `extractGps(filePath)` uses `exifr` to pull GPS coords. Returns `null` if missing; the file still proceeds, landing in `Unknown Location`.
2. **`geocoder.ts`** — `reverseGeocode(coords)` calls the Nominatim OpenStreetMap API. Returns `state` (top-level folder) and `city` (second-level folder). Results are cached in a module-level `Map` keyed by coords rounded to 3 decimal places — the cache is in-memory only and does not persist across app restarts.
3. **`vision.ts`** — `classifyPhoto(filePath)` runs local MobileNet inference via TensorFlow.js (CPU backend, no API key required). The model (~16MB) is downloaded from the internet on first use and cached in memory for the session. Predictions scoring above 0.1 are matched against `CATEGORY_MAP` in priority order. The first match wins; unmatched photos fall into `Other`. HEIC/HEIF files are converted to a temp JPEG via macOS `sips` before processing; the temp file is deleted afterward.
4. **`organizer.ts`** — assembles the destination path under `Photos/`, creates directories, **copies** the file (originals are preserved).

**Document pipeline** — `organizeDocument()` in `document-organizer.ts`:

1. Read the PDF file.
2. Classify document type, source, and date:
   - **With API key:** Sends the full PDF as a vision document block to Claude Haiku (`claude-haiku-4-5`). Claude sees the actual layout, logos, headers, tables, and formatting — far more accurate than text extraction. Returns document type, source/company, and document date in one call. User-defined excluded terms are included in the prompt.
   - **Without API key:** Falls back to filename-based heuristic classification using doc-type keywords and smart vendor extraction.
   - **Vendor extraction from filename** (`extractVendorFromFilename`): tries 5 strategies in order: `_from_` marker, `" - "` delimiter, `_-_` delimiter, split before doc-type keywords (SOW, PROPOSAL, etc.), underscore/hyphen segment analysis.
   - **Supplement pass:** If Claude (or fallback) returns `source: 'Unknown'`, the filename vendor extractor runs as a second pass.
   - **Excluded terms** are filtered out at every stage — Claude prompt, result validation, and filename extraction. Two sources are merged: permanent terms from Settings (`excludedTerms`) and one-time per-sort terms entered in the pre-sort staging prompt. Per-sort terms do not persist.
3. Date comes from Claude's analysis when available, otherwise file mtime.
4. Copy to `<outputDir>/Documents/<DocumentType>/<Source>/<Year>/<MM Mon>/`

### Manual review flow

Files classified with "Unknown" or "Other" in any field are flagged for review:

- **Inline review** — Each flagged result card shows a pencil icon (edit path) and checkmark (accept sort). Editing opens an inline path input; pressing Enter or clicking Move relocates the file on disk.
- **Bulk review** — The "N files need review" button opens the ReviewPanel with all unknowns listed. Users can select all/individual files, edit paths, and move or accept them in bulk.
- **Accept** — Dismisses the review flag for individual files or all at once. Accepted files are tracked per-session in an `acceptedIndices` Set.
- Files can also be moved via the `move-file` IPC handler, which takes the current absolute path and a new relative path under `outputDir`.
- **Empty folder cleanup** — After any file move (inline or bulk), `pruneEmptyDirs()` walks up from the old directory, deleting empty folders until it hits one with files or reaches `outputDir` (which is never deleted).

### File preview

Clicking the eye icon on any result card (in session results, history, or the review panel) opens the file in a **separate native Electron window**. The preview window is independent — users can interact with the main window while it's open. Clicking outside the preview window (blur) closes it.

- **JPEG, PNG, WebP, GIF** — rendered directly via an HTML `<img>` wrapper with base64 data URL.
- **HEIC, HEIF, TIFF**, and other non-Chromium-native formats — converted to JPEG via macOS `sips` before display. Temp file is deleted after reading.
- **PDF** — loaded directly via `BrowserWindow.loadFile()` using Chromium's built-in PDF viewer.

## Output folder structure

```
<outputDir>/
  Photos/
    <State>/
      <City>/
        <Category>/
          photo.jpg
    Unknown Location/
      <Year>/
        <MM Mon>/
          <Category>/
            photo.jpg
      Screenshots/
        <Year>/
          <MM Mon>/
            screenshot.png
  Documents/
    <DocumentType>/
      <Source>/
        <Year>/
          <MM Mon>/
            document.pdf
```

Example: `~/Pictures/Sorted/Photos/California/San Francisco/Landscapes & Nature/IMG_0042.jpg`

Photos with no GPS are sorted by date: `Photos/Unknown Location/<Year>/<Month>/<Category>/`. Screenshots (detected by filename containing "screenshot") go into `Photos/Unknown Location/Screenshots/<Year>/<Month>/` with no category subfolder. Date comes from EXIF `DateTimeOriginal` if present, otherwise file modification time. Month format is `01 Jan`, `02 Feb`, etc. for chronological Finder sorting. State and city strings are sanitized (characters `/ \ : * ? " < > |` replaced with `-`).

**Collision handling:** if the destination filename already exists, `organizer.ts` appends `_1`, `_2`, etc. before the extension using a `while (existsSync)` loop (`base_1.jpg`, `base_2.jpg`, …).

**Originals are preserved:** the organizer copies files to the destination rather than moving them.

### Category buckets (vision.ts `CATEGORY_MAP`)

| Folder name | Trigger keywords (partial match, case-insensitive) |
|---|---|
| Food & Dining | pizza, hamburger, hotdog, sandwich, burrito, soup, salad, sushi, bread, cake, cookie, coffee, espresso, wine, beer, cocktail, restaurant, dining |
| Animals & Pets | dog, cat, bird, fish, horse, elephant, bear, zebra, giraffe, sheep, cow, rabbit, hamster, parrot, aquarium |
| Landscapes & Nature | mountain, seashore, beach, forest, valley, cliff, lakeside, waterfall, geyser, coral reef, alp, volcano, desert, tundra, rainforest, canyon, prairie, sky, sunset, sunrise |
| Architecture & Cities | castle, church, monastery, mosque, palace, museum, library, bridge, tower, skyscraper, architecture, street, traffic, parking |
| Travel & Transport | aircraft, airplane, airport, car, train, boat, ship, submarine, bicycle, motorcycle, bus, truck, canoe, kayak, locomotive |
| Sports & Activity | tennis, basketball, football, soccer, baseball, golf, swimming, cycling, running, skiing, snowboard, surfboard, gym, dumbbell, stadium |
| Documents & Screenshots | monitor, keyboard, mouse, laptop, phone, remote control, television, camera, tripod |
| Other | (no match) |

Buckets are evaluated in the order listed; the first match wins.

### Document type categories

The Claude prompt and fallback heuristics recognize: Invoice, Receipt, Contract, Statement, Tax Form, Letter, Report, Manual, Resume, Legal, Insurance, Medical, Correspondence, Application, Certificate, Permit, Proposal, Presentation, Spreadsheet, Other. Folder names are pluralized (e.g. Invoices, Contracts, Proposals).

## Configuration (electron-store)

Settings are persisted by `electron-store` in the platform's standard app-data location (macOS: `~/Library/Application Support/snap-sortie/config.json`). The `Settings` interface in `store.ts` defines:

| Field | Purpose |
|---|---|
| `outputDir` | Root folder where organized files are copied |
| `anthropicApiKey` | Anthropic API key for Claude Haiku document classification (optional — falls back to keyword matching) |
| `excludedTerms` | Comma-separated words/names to permanently exclude from document source detection (e.g. your own company name). Applied to every sort. Per-sort exclusions are entered in the pre-sort prompt and merged at runtime but not saved. |

The app throws at organize-time if `outputDir` is empty.

## IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `organize-photos` | renderer → main | Organize an array of file paths (optional 2nd arg: per-sort exclusion terms) |
| `get-settings` / `save-settings` | renderer → main | Read/write settings |
| `pick-folder` / `pick-files` | renderer → main | Native file/folder dialogs |
| `reveal-in-finder` | renderer → main | Show file in Finder (returns `false` if file missing) |
| `move-file` | renderer → main | Move file to new relative path under outputDir; prunes empty dirs after |
| `open-preview-window` | renderer → main | Open file in a separate preview window (converts HEIC/TIFF via sips) |
| `get-output-dir` | renderer → main | Get outputDir for computing relative paths |
| `open-files` | main → renderer | Menu-triggered file open (Cmd+O) |

## Menu bar

- **Snap Sortie** — About, Services, Hide, Quit
- **File** — Open File(s)… (Cmd+O), Close, Quit (Cmd+Q)
- **Edit** — Cut, Copy, Paste, Select All
- **Window** — Show Snap Sortie (Cmd+N), Minimize, Zoom

## Vite aliases

| Alias | Resolves to |
|---|---|
| `@main` | `src/main/` |
| `@renderer` | `src/renderer/src/` |

The preload bundle has no alias — import from relative paths.
