# MM Album Design Tools v0.3.0

A compact Photoshop UXP panel for album-design production utilities. The panel includes:

1. **Auto Photo Fill**
2. **Swap Photos**

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

## Swap Photos

1. Select exactly 2 or 3 Smart Object photo layers in the active document.
2. Click **SWAP PHOTOS**.
3. **2 photos:** Direct content swap between the two Smart Objects:
   - Layer 1 <- Content of Layer 2
   - Layer 2 <- Content of Layer 1
4. **3 photos:** Deterministic cyclic content swap in top-to-bottom layer order:
   - Layer 1 <- Content of Layer 3
   - Layer 2 <- Content of Layer 1
   - Layer 3 <- Content of Layer 2
5. Smart Object layers stay in their exact stack positions with clipping masks, transforms, effects, and placeholder relationships intact (content-based swap via `placedLayerExportContents` and `placedLayerReplaceContents`).
6. All contents are exported to temporary PSB files before any replacement begins, preventing data loss.
7. In-document operation only: does not touch source photo folders, picker, or `Album Used`.
8. Collapses into a single undo step ("MM Swap Photos") with automatic pre-swap rollback on error.



## v0.2.3 filesystem fix

The old movement path used `getNativePath()` correctly, but pre-encoded the parent with `encodeURIComponent` before calling UXP's `getEntryWithUrl`. The reported `%2520` means an already encoded `%20` was encoded again. There is no second encoding call in this repository's movement path: the evidence points to UXP's resolver boundary. The regression fixture models that reported host behavior; it does not replace a Photoshop runtime test.

Movement still uses **Entry APIs**, under the unchanged `fullAccess` permission. Each successfully placed picker entry goes through `localFileSystem.getNativePath()`, native parent derivation, raw UXP `file:/` path resolution, source reacquisition via `parent.getEntry(filename)`, folder creation/reuse, and `moveTo(..., { newName, overwrite: false })`. Only the separator is normalized for UXP. No encoded string or picker `Entry.url` supplies a disk path. No browser URL object is used in production.

For example, the native source `G:\WORKING ALBUM\SAVE EDITED PHOTOS\ANAMIKA\Memory Maker 1 DT.jpg` gives native parent `G:\WORKING ALBUM\SAVE EDITED PHOTOS\ANAMIKA`. The resolver receives raw path text `file:/G:/WORKING ALBUM/SAVE EDITED PHOTOS/ANAMIKA`, leaving encoding to UXP. The canonical diagnostic URL is `file:///G:/WORKING%20ALBUM/SAVE%20EDITED%20PHOTOS/ANAMIKA`; it is never fed back into the resolver. The old failing URL was `file:///G:/WORKING%2520ALBUM/SAVE%2520EDITED%2520PHOTOS/ANAMIKA`.

This distinction matters: manually encoding even a three-slash browser URL and feeding it to the same host resolver would retain the risk of double encoding. The diagnostic formatter encodes raw segments exactly once. Movement preserves raw spaces, `#`, `%`, `&`, parentheses, and Unicode/Bengali folder and file names, including a literal `%20` name (which must not be decoded into a space). Drive-root parents retain their slash. Local drive and POSIX paths remain accepted; UNC/device paths remain unsupported.

`Album Used` is automatically created only when the lookup reports a missing entry. An existing folder is reused and cached per native parent during the run; an existing file with that name is an error. Each source uses its own parent. Destinations such as `photo.final.jpg`, `photo.final_2.jpg`, and `photo.final_3.jpg` preserve the basename and extension; overwriting is disabled even if a competing writer creates the selected name after the collision check. A failed move retains the source and the successful Photoshop placement, and processing continues. There is no copy/delete fallback or placement rollback.

The Entry strategy preserves writable source reacquisition and the documented no-overwrite move option. Adobe's native `fs` supports `mkdir`, `lstat`, and `rename`, but its documented `rename` signature has no no-overwrite option; checking for a name before native rename would leave an overwrite race. References: [Adobe UXP fs](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/fs/fs), [Entry.moveTo](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/uxp/persistent-file-storage/entry), and [filesystem path schemes and permissions](https://developer.adobe.com/uxp/guides/how-to/recipes/filesystem-operations/).

Failures retain the original error object and include a diagnostic category: `PATH / NOT FOUND`, `PERMISSION`, `LOCK / IN USE`, or `FILESYSTEM` when unknown. Recognized codes/names take precedence over message heuristics. Permission, lock, and unknown lookup failures are not treated as missing folders or free filenames. The panel shows the failure count and at most three concise details; the developer console records every failure with source native path, parent, Album Used path, chosen destination when available, resolver input, canonical URL, operation, and original error name/code/message. Some hosts report locks only as permission failures; the plugin cannot infer information the host does not expose.

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
- `main.js` — panel bootstrap, tool-button wiring, and toast presentation
- `src/tools/swapPhotos.js` — Swap Photos orchestration, target resolution, and cyclic swaps
- `src/ui/toast.js` — temporary panel toast management
- `src/tools/autoPhotoFill.js` — Auto Photo Fill orchestration and completion summaries
- `src/orientation.js` — pure dimension/orientation classification
- `src/matcher.js` — pure deterministic matching engine
- `src/documentOwnership.js` — guards temporary-document ownership during dimension inspection
- `src/layers.js` — selected-layer retrieval in top-to-bottom order
- `src/photoshop.js` — image inspection and Smart Object placement engine
- `src/files.js` — multiple-image picker and collision-safe `Album Used` movement
- `tests/` — Node tests for layout, matching, classification, workflow, file movement, swap logic, toasts, and Photoshop-boundary contracts

## Test in Photoshop

1. Open **UXP Developer Tool**.
2. Add this folder's `manifest.json` and click **Load**.
3. In Photoshop choose **Plugins > MM Album Design Tools**.
4. Open an album PSD and select placeholder layers.
5. Click **AUTO PHOTO FILL** and choose source photos.
6. Verify the visible panel completion result (no popup), placed Smart Objects, cover-fit, clipping, layer names, and `Album Used` contents.

### Manual v0.2.3 retest checklist

Use disposable copies of source photos for these movement tests. Reload the plugin and confirm the panel shows v0.2.3.

- **A — Create:** Start with `D:\TEST ALBUM\PHOTOS` and no `Album Used`. Run Auto Photo Fill. Expect automatic creation of `D:\TEST ALBUM\PHOTOS\Album Used` and movement of successfully placed sources.
- **B — Reuse:** Run again with that folder present. Expect reuse, with no `Album Used 2` or `Album Used_2`.
- **C — Spaces:** Use `D:\MY WEDDING ALBUM\EDITED PHOTOS`. Expect movement without a `%2520` path error.
- **D — Original failure:** Use `G:\WORKING ALBUM\SAVE EDITED PHOTOS\ANAMIKA`. Expect folder creation/reuse and movement without `Could not find an entry of file:///...%2520...`.
- **E — Extras:** Select six readable photos for four placeholders. Expect four placements and four moved sources; two extras stay in the source directory.
- **F — Collision:** Put `photo.jpg` in the destination first, then place another source named `photo.jpg`. Expect `photo_2.jpg` and unchanged original destination contents; repeat with `_2` present to check `_3`.
- **G — Bengali and special characters:** Use Bengali folder and file names, then paths with `#`, `%`, `&`, and parentheses. Expect creation/movement where Windows/UXP permits them. Also check a literal `%20` folder remains distinct from a space.
- **H — Permissions:** Use a protected/read-only source or destination. Expect placement and source contents preserved, a categorized permission failure, and continued processing of other accessible photos. Check console operation/code details.
- **I — Lock:** If practical, lock a source file with another application. Expect no source deletion or placement rollback, and a reported move error; a lock label requires a lock-specific host error.
- **J — Working workflow:** Verify normal matching, cover-fit, embedded Smart Objects, clipping, layer naming, forced orientation fallback, skipped counts, JPG/JPEG/PNG multiselect, and in-panel completion. Successfully force-filled sources must move too.

Photoshop runtime validation is still required. Node fixtures model UXP's encoding and Entry operations; browser layout tests do not run Photoshop. Host-specific raw path parsing, actual permissions/locks, Unicode handling, and removable/network-backed drive availability remain runtime checks.

## Automated tests

Run from this folder:

```powershell
node --test tests/*.test.js
```

The layout test requires an installed Chrome or Edge browser.

Photoshop owns the outer UXP panel window. The panel keeps one vertical scroller, suppresses horizontal overflow, and uses normal document flow at narrow, docked, floating, and wide sizes.
