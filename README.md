# MM Album Design Tools v0.2.2

A compact Photoshop UXP panel for album-design production utilities. The first included tool is **Auto Photo Fill**.

The existing plugin ID remains `in.memorymaker.albumplacer`, so installations of Memory Maker Album Placer upgrade to this product name instead of creating a second plugin.

## Auto Photo Fill

1. Open an album PSD in Photoshop.
2. Select the placeholder layers to fill.
3. Click **AUTO PHOTO FILL**.
4. Choose multiple source photos.
5. The plugin reads placeholder and photo dimensions, prefers matching orientations, and force-fills remaining slots in stable order.
6. Square, round, and near-square placeholders are treated as flexible and may accept either orientation.
7. Matched photos are placed as embedded Smart Objects, cover-fitted, centered, clipped, and renamed.
8. Only successfully placed source photos are moved into an `Album Used` folder inside each photo's original source directory.
9. Extra, unreadable, or failed photos remain untouched in their source location.

## v0.2.2 runtime fixes

Disk movement obtains each source path with `localFileSystem.getNativePath()`. It encodes the absolute native parent path as a `file:/` URL, resolves a writable folder under the existing `fullAccess` permission, and reacquires the source file through that folder. Picker `Entry.url` is never used for disk movement. Spaces, `#`, `%`, and Unicode path segments are encoded separately; Windows drive roots retain their slash. Local drive and POSIX paths are supported; UNC/device paths are rejected with a reported move failure.

`Album Used` is created or reused per source folder. Filenames are preserved where available; collisions use `_2`, `_3`, and so on with overwriting disabled. Movement failure keeps the successful Photoshop placement and is reported in the result.

The completion modal has been removed because it rendered as blank host chrome in Photoshop. Completion, warnings, and errors appear in the existing dark panel result section. The result is revealed and scrolled/focused where supported; a new run hides the previous result. Status remains `Complete.` after processing.

## Orientation rules

- Ratio below `0.90`: portrait
- Ratio above `1.10`: landscape
- Ratio from `0.90` through `1.10`: flexible

Exact portrait and landscape matches are assigned before flexible placeholders. Square photos prefer flexible placeholders. Any photos and placeholders still remaining are paired in their original stable order, so orientation mismatch alone never leaves a usable slot empty.

When the number of usable photos equals the number of readable selected placeholders, all placeholders are filled unless a technical placement failure occurs. A forced mismatch still uses the existing aspect-ratio-preserving cover fit and clipping behavior.

## Project structure

- `manifest.json` — Photoshop UXP plugin definition
- `index.html` / `style.css` — responsive multi-tool panel shell
- `main.js` — panel bootstrap, global status, panel results, and tool-button wiring
- `src/tools/autoPhotoFill.js` — Auto Photo Fill orchestration and completion summaries
- `src/orientation.js` — pure dimension/orientation classification
- `src/matcher.js` — pure deterministic matching engine
- `src/documentOwnership.js` — guards temporary-document ownership during dimension inspection
- `src/layers.js` — selected-layer retrieval in top-to-bottom order
- `src/photoshop.js` — image inspection and Smart Object placement engine
- `src/files.js` — multiple-image picker and collision-safe `Album Used` movement
- `tests/` — Node tests for layout, matching, classification, workflow, file movement, and Photoshop-boundary contracts

## Test in Photoshop

1. Open **UXP Developer Tool**.
2. Add this folder's `manifest.json` and click **Load**.
3. In Photoshop choose **Plugins > MM Album Design Tools**.
4. Open an album PSD and select placeholder layers.
5. Click **AUTO PHOTO FILL** and choose source photos.
6. Verify the visible panel completion result (no popup), placed Smart Objects, cover-fit, clipping, layer names, and `Album Used` contents.

## Automated tests

Run from this folder:

```powershell
node --test tests/*.test.js
```

The layout test requires an installed Chrome or Edge browser.

Photoshop owns the outer UXP panel window. The panel keeps one vertical scroller, suppresses horizontal overflow, and uses normal document flow at narrow, docked, floating, and wide sizes.
