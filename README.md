# MM Album Design Tools v1.2.0 DEV

A polished Photoshop UXP panel for album-design production workflows. The plugin ID remains `in.memorymaker.albumplacer`.

## 8 Action Grid

The panel presents an 8-button responsive 2-column grid with clean line icons and a dedicated narrow single-column fallback:

1. **OPEN PSD**
2. **AUTO PHOTO FILL**
3. **SWAP PHOTOS**
4. **FLIP PHOTO**
5. **SAVE PAGE**
6. **SAVE EDITED PHOTOS**
7. **SAVE PSD CATEGORY**
8. **REMOVE PHOTOS** (destructive styling: dark red)

---


## What's New in v1.2.0

### Create Album / Create Page
- Adds a dedicated **Create Album** section below the existing production tools.
- **12 × 36 Album:** creates a 10800 × 3600 px RGB page at 300 DPI.
- **12 × 18 Album:** creates a 5400 × 3600 px RGB page at 300 DPI.
- Album pages automatically receive a **0.25 inch outer safe margin**, a **center fold guide**, and **0.25 inch center-safe guides on both sides of the fold** (0.50 inch total center-safe zone).
- Adds **Instagram Post** (1080 × 1080), **Facebook Post** (1200 × 1500), and **YouTube Thumbnail** (1280 × 720) presets, all at 300 DPI.
- Adds **Custom Page** with inch/pixel dimensions and White/Black/Transparent background; resolution remains fixed at 300 DPI.
- Page creation runs inside Photoshop `executeAsModal`, is protected by the existing license gate, and participates in the shared button-locking state.

### CREATE ALBUM assets

CREATE PAGE remains the full-width first action below the original eight-tool grid. The green tool buttons use three rows: **ADD FRAME / SAVE FRAME**, **PNG MASK / PNG TEXT**, then **CLIP ART / an empty future slot**, with the existing single-column fallback for narrow panels.

| Action | Asset / result | Independent root key | Select label |
| --- | --- | --- | --- |
| CREATE PAGE | Preset or custom album/social canvas | None | Existing page presets |
| ADD FRAME | PSD contents as editable grouped layers | `mm_add_frame_folder_token` | SELECT PSD FRAME |
| SAVE FRAME | Selected layers/groups exported as a layered PSD | `mm_save_frame_root_folder_token` | SAVE FRAME |
| PNG MASK | Transparent PNG as an embedded Smart Object | `mm_png_mask_folder_token` | SELECT PNG MASK |
| PNG TEXT | Transparent PNG graphic as an embedded Smart Object | `mm_png_text_folder_token` | SELECT PNG TEXT |
| CLIP ART | Transparent PNG as an embedded Smart Object | `mm_clip_art_folder_token` | SELECT CLIP ART |

Every asset root can be changed independently. The three PNG tools share `src/tools/addAsset.js` and one category-configured compact dialog. The heading identifies the category; **ROOT FOLDER**, **No folder selected**, **SET FOLDER / CHANGE FOLDER**, the exact category SELECT label, and **CANCEL** follow the same interaction pattern as ADD FRAME. SELECT stays disabled until a valid root is saved. Long paths use ellipsis while retaining the full tooltip; warnings/errors remain visible inside the reopened dialog.

SET/CHANGE uses native UXP folder selection and persistent tokens, preserving existing roots on cancellation or storage failure. Each root survives panel reopen, plugin reload and Photoshop restart. Invalid tokens clear only that category. File selection uses `{ initialLocation: rememberedRoot, types: ["png"], allowMultiple: false }`; cancelling or navigating elsewhere never changes the saved root. No document means **Create or open a page first.**, with no file picker.

PNG placement uses an embedded `placeEvent` with a UXP session token and `linked: false`, without opening or saving the source PNG. Each new layer receives the filename without `.png`, stays independent of existing groups, is uniformly scaled down only if it exceeds 80% of the canvas width or height, and is centered and selected for Ctrl+T. Small assets are not enlarged. PNG MASK does not create a clipping mask; PNG TEXT remains a graphic, with no OCR or editable-text conversion; CLIP ART has no special clipping behavior. ADD FRAME continues using its separate editable PSD group importer.

Each PNG import runs in one modal/history operation: **Add PNG Mask**, **Add PNG Text**, or **Add Clip Art**. Failed placement/transforms roll back partial additions and log the native error. The existing license gate, running lock, DEV bypass and v1.2.0 version apply to all three tools; no production CCX is generated.

#### SAVE FRAME

Open a market/source PSD and select the frame layers or groups to keep. **SAVE FRAME** opens a compact dark dialog with **FRAME LIBRARY ROOT**, **SET FOLDER / CHANGE FOLDER**, **NUMBER OF PHOTOS**, **SAVE FRAME** and **CANCEL**. The dropdown offers **1 PHOTOS** through **12 PHOTOS**, defaulting to **3 PHOTOS**. Escape cancels, buttons support Enter/Space, and long paths keep their full tooltip. Without a root, the path says **No frame library folder selected** and SAVE FRAME is disabled.

Set the library root with the native UXP folder picker. Its dedicated persistent key, `mm_save_frame_root_folder_token`, is independent of every other tool. Cancelled folder changes keep the old root; successful changes update the path immediately. Stale roots clear only this key. The chosen photo count survives folder changes within the dialog.

Saving to **5 PHOTOS**, for example, uses `<root>/5 PHOTOS/`, automatically creating that subfolder if missing and reusing it otherwise. Each folder has its own sequence: **Frame 001.psd**, **Frame 002.psd**, etc. The highest matching PSD number plus one is padded to at least three digits; existing files are never overwritten. The optional custom prefix is omitted in this development version.

`src/tools/saveFrame.js` captures the source/selection before configuration, creates a transparent temporary document with the source's full width, height, PPI and practical color mode, and duplicates only the selected native layers/groups individually from bottom to top. A selected group includes its nested content; selecting both a group and its descendant does not duplicate the child twice. Native duplication retains editable text, Smart Objects, masks, effects and other supported layer properties. The exporter preserves positions without scaling, flattening or rasterizing, removes the temporary empty layer, trims the temporary document's transparent canvas to the actual visible non-transparent content bounds (equivalent to Photoshop `Image > Trim > Transparent Pixels` on Top, Bottom, Left, and Right), preserving all selected layers/groups as editable layers and preserving visible drop shadows, outer glows, strokes, masks, and transformed content without preserving unnecessary empty 12x36, 12x18 or source-document canvas size, and calls Photoshop `saveAs.psd(file, { layers: true, embedColorProfile: true }, true)`. RGB, CMYK, grayscale and Lab are supported creation modes; unsupported modes use RGB without changing the source. Supported 8/16/32-bit depth, color profile and pixel aspect ratio are also carried over. Clipping is retained when its actual base is also selected and the original relationship can be preserved; otherwise the selected content exports standalone without borrowing unselected layers. Adjustment appearance also depends on which related layers are selected.

Only the owned temporary document is closed without further saving. Source layers remain unchanged, and source focus and original selection are restored. Failed saves clean up their unfinished file and temporary document, log native errors, and retain a useful error in the configuration dialog for retry. No document reports **Open a PSD first.**; no selection reports **Select one or more frame layers first.** Success closes the workflow and reports, for example, **Saved frame: 3 PHOTOS / Frame 004.psd**. SAVE FRAME uses the existing shared running lock, license gate and unchanged DEV bypass; the version remains **v1.2.0 DEV** and no CCX is generated.

#### SAVE FRAME manual Photoshop verification

1. Reload the unpackaged plugin. Confirm CREATE PAGE remains full-width below the original eight tools, with ADD FRAME / SAVE FRAME, PNG MASK / PNG TEXT and CLIP ART / empty slot beneath it. Check wide and narrow panels and the SAVE FRAME icon.
2. With no document, confirm **Open a PSD first.** With a document and no selected layers, confirm **Select one or more frame layers first.** Confirm neither case opens a picker or creates a file.
3. Select layers and open SAVE FRAME without a root. Confirm heading, root label, no-folder text, SET FOLDER, disabled SAVE, all 12 dropdown choices and default 3 PHOTOS. Test CANCEL, Escape, Tab, Enter/Space and cancelled SET FOLDER.
4. Set a root. Confirm immediate path/tooltip, enabled SAVE and CHANGE FOLDER. Change the count, cancel CHANGE and confirm root/count survive; change successfully and confirm the other tools' roots remain untouched. Reopen/reload/restart Photoshop to check persistence. Move/delete the root and confirm only SAVE FRAME resets.
5. Export to a missing category and an existing one. Confirm auto-creation/reuse, Frame 001/002 numbering, independent sequences in another category, ignored unrelated files, and no overwriting. Confirm the success toast's category/filename.
6. Select multiple layers, a nested group, a group plus its selected child, and a child without its parent. Reopen exported PSDs and confirm only selected content is included once, stacking/nesting/names remain correct, and no extra blank layer is saved.
7. Export editable text, embedded/linked Smart Objects, masks/vector masks, effects, opacity/blends, adjustment layers and clipping stacks with their bases selected. Check editability and appearance in the saved PSD, transparent areas around/inside the frame, trimmed canvas bounds (no fixed 12x36, 12x18 or source dimensions), preserved drop shadows/glows/strokes/masks, PPI and practical RGB/CMYK/grayscale/Lab modes (including 16/32-bit where PSD supports them).
8. Confirm the source tab, original selection, layer hierarchy/names/positions, dirty state and history remain unchanged after success/cancellation/errors. Confirm other open documents stay open and no export document remains.
9. Use a read-only/unavailable destination, a conflicting file named `N PHOTOS`, and unsupported/oversize PSD content. Confirm useful errors, native console details, no corrupted replacement of an existing frame, temporary cleanup, retry/cancel and button unlocking.
10. Recheck CREATE PAGE, ADD FRAME, all three PNG tools and the original eight actions. While SAVE FRAME is open/saving, confirm conflicting buttons stay locked; verify normal licensing with DEV bypass disabled for the check, then restore the DEV setting.

#### PNG asset manual Photoshop verification

1. Reload the unpackaged plugin and confirm CREATE PAGE spans the first row, followed by ADD FRAME / SAVE FRAME, PNG MASK / PNG TEXT and CLIP ART / empty slot below the original tools. Confirm all original tools and ADD FRAME still work.
2. For each PNG category, open its dialog with no saved root. Confirm its exact heading and SELECT label, **No folder selected**, SET FOLDER, disabled SELECT, CANCEL, Escape and Enter/Space behavior. Cancel SET FOLDER and confirm no token is saved.
3. Set three different roots; confirm the immediate path/tooltip, CHANGE FOLDER and enabled SELECT. Reopen the panel, reload the plugin and restart Photoshop; confirm all three roots and the ADD FRAME root remain independent. Cancel CHANGE, then successfully change one root, and confirm the other roots are untouched. Move/delete one root and confirm only that category returns to SET FOLDER.
4. Confirm each native picker starts at its own root, filters PNG and allows one selection. Cancel to return to configuration. Navigate elsewhere and import a PNG; reopen and confirm the original configured root is unchanged. With no page open, confirm the exact warning and no picker.
5. Import transparent PNGs in all three categories, including PNG text artwork and a mask. Confirm filename layer names, transparent edges, Embedded Smart Object status, no clipping or OCR, independence from an already-selected album group/clipping stack, preservation of existing clipping relationships, and that source PNGs remain unchanged.
6. Test large landscape/portrait and small PNGs. Confirm equal X/Y scaling down only, 80% maximum coverage, centering and selection. Use Ctrl+T to move/resize/rotate; undo the transform, then undo the category import once and confirm the complete asset disappears.
7. Try a corrupt PNG and simulate a placement/transform failure in DEV. Confirm a category-specific error, native console diagnostics, no broken new layers and the original album still active. Attempt another tool during import and confirm the shared lock prevents conflicting operations.

### ADD FRAME
- **CREATE PAGE** remains the first full-width action in **CREATE ALBUM**; **ADD FRAME** stays in the two-column tool row below it. The existing narrow-panel fallback is retained.
- ADD FRAME opens a compact dark configuration dialog with **FRAME ROOT FOLDER**, its remembered path, **SET FOLDER** or **CHANGE FOLDER**, **SELECT PSD FRAME**, and **CANCEL**. Without a root, it displays **No frame folder selected** and disables SELECT PSD FRAME. No native picker opens until an action is chosen.
- SET FOLDER uses the native UXP folder picker and persists the selected root under `mm_add_frame_folder_token`. The root survives panel reopen, plugin reload, and Photoshop restart. Paths come from the UXP folder Entry, are visually ellipsized when long, and retain their complete text in a tooltip.
- CHANGE FOLDER replaces the root only after a readable selection and successful persistent-token storage. Cancelling either folder action returns to the same configuration dialog without changing the token. Stale or inaccessible tokens clear only ADD FRAME's root and return to SET FOLDER; other tools' settings are untouched.
- **SELECT PSD FRAME** opens `localFileSystem.getFileForOpening` with `{ initialLocation: rememberedRoot, types: ["psd"], allowMultiple: false }`. Every picker starts at the configured root. Navigating to another folder or selecting a PSD elsewhere never changes that root. Cancelling file selection returns to the configuration dialog without importing. The previous custom PSD list has been removed; no custom browser or thumbnails are generated.
- A selected PSD imports into the active album as one **editable Photoshop group**, named from its filename without `.psd`. The tool opens the PSD temporarily and duplicates whole top-level layers/groups individually, bottom-to-top, with `layer.duplicate(target)`, using one `source.duplicateLayers([layer], target)` fallback if necessary. It groups **only those target copies** with `target.createLayerGroup({ name, fromLayers: copies })`. Native duplication preserves nested groups, text, shapes, existing Smart Objects, masks, effects, stacking order, opacity, blend modes, clipping relationships, and adjustment layers wherever Photoshop supports them.
- The whole PSD is never flattened, rasterized, merged, or converted to a Smart Object. The temporary source is closed **without saving**, and the target page is restored. Selecting the album itself or a source PSD that was already open is refused, so existing user documents are not discarded; close an already-open source before importing its saved asset.
- The group is proportionally scaled **down** only when its bounds exceed **80% of the target width or height**, then centered on that canvas. Smaller groups are not enlarged. The group stays selected for **Ctrl+T / Cmd+T** resizing, moving, and rotating; expand it to edit the original layer structure.
- The successful import closes the configuration workflow and returns to the target page. With no active page, the warning is **Create or open a page first.** Warnings and errors show a useful toast and remain visible inside the reopened configuration dialog for retry. Cancellation and Escape stop the workflow. Native pickers run outside Photoshop's modal document-editing scope and after releasing the configuration dialog.
- Import, grouping, fitting, and selection run inside one `executeAsModal` scope with a target history suspension named **Add PSD Frame**. One undo removes the new group. Failures roll back all target changes, including duplication that fails after creating some layers; source cleanup and target restoration run on both success and failure.
- ADD FRAME uses the existing central action handlers, button locking, licensing, and DEV bypass. No network calls or production CCX are introduced. This remains **v1.2.0 DEV**.

#### Photoshop manual verification
1. Reload the unpackaged plugin. Verify the existing CREATE ALBUM layout, CREATE PAGE presets/custom page, and all eight original tools. Keep the current DEV bypass and version.
2. Clear only ADD FRAME's token for a first-use check. Opening ADD FRAME should show **No frame folder selected**, SET FOLDER, disabled SELECT PSD FRAME, and CANCEL. Cancel SET FOLDER; nothing should be stored. Then select a root and confirm the path, tooltip, CHANGE FOLDER label, and enabled SELECT PSD FRAME update immediately.
3. Close/reopen the panel, reload the plugin, and restart Photoshop. Confirm the same root appears without a folder picker. Test long paths, spaces, and non-ASCII names. Cancel CHANGE FOLDER and confirm the old root remains; choose a new root and confirm replacement. Move/rename/delete the saved root and confirm SET FOLDER returns without affecting other tools' folder memory.
4. With an album open, press SELECT PSD FRAME repeatedly and confirm the native picker starts in the configured root each time. Cancel and confirm the dialog returns. Navigate elsewhere and select a PSD; confirm the configured root remains unchanged afterward. With no document open, confirm **Create or open a page first.**
5. Import a layered test PSD containing nested groups, editable text, shapes, pixel layers, an existing Smart Object, masks/vector masks, effects, clipping, adjustments, opacity, and blend modes. Confirm one filename-named group contains all source layers in the correct order, and the pre-existing album layers remain outside it. Expand the group and edit its contents.
6. Test large landscape/portrait and small frames. Confirm uniform downscale to roughly 80%, centering, no small-frame enlargement, and selection of the new group. Use Ctrl+T to resize/move/rotate, then undo the transform and undo **Add PSD Frame** once; the entire imported group should disappear.
7. Confirm the temporary source closes, the album is active, and the original PSD on disk remains unchanged. Selecting an already-open source or the album itself should safely refuse import. Test an invalid PSD or a host import failure and confirm no partial layers remain, the source is closed if opened by ADD FRAME, and a useful error appears. Node tests simulate Photoshop; native PSD fidelity and real undo behavior require these checks.

---
## What's New in v1.1.0

### Production Licensing Runtime
- **Production License Activation:** Online license key activation via dedicated licensing server API (`/v1/activate`) with immediate cryptographically verified binding.
- **Max-Device Licensing:** Strict enforcement of multi-device quotas per license with friendly device limit notifications.
- **Signed Offline Token Validation:** Offline verification of MM1 tokens signed with Ed25519; fast startup verification without mandatory network access.
- **7-Day Refresh Target:** Background online token refresh attempted after 7 days (`REFRESH_INTERVAL_DAYS = 7`).
- **14-Day Offline Grace:** Continued full offline operation during server downtime or travel up to 14 days (`OFFLINE_GRACE_PERIOD_DAYS = 14`).
- **License Management UI:** Clean modal dialog accessible from the panel for activating licenses, reviewing plan and expiration status, verifying device binding, and deactivating computers.
- **Adobe UXP secureStorage Restart Persistence:** Comprehensive cross-session persistence fix handling native Adobe UXP `Uint8Array` payloads with a UXP-safe pure JavaScript UTF-8 codec and zero Node `Buffer` runtime dependency.

---

## What's New in v1.0.0

### 1. Branded Responsive Panel UI
- **Branding Header:** Displays `MEMORY MAKER` in brand green with expanded letter-spacing, bold white `Album Design Tools`, and muted `v1.0.0` aligned top-right.
- **Responsive 2-Column Grid:** 2 columns × 4 rows in standard panel widths, automatically collapsing into a single column on narrow docked panels without text clipping or button overlap.
- **Button Styling:** Explicit Memory Maker green on non-destructive buttons, dark red on `REMOVE PHOTOS`.
- **Line Icons:** Lightweight inline SVG line icons embedded directly into each button.
- **Developer Footer:** Subtle divider and credit `Developed by Rammoni Halder`.

### 2. Per-Tool Folder Memory
Each tool independently remembers its own folder location using UXP persistent tokens:
- **OPEN PSD:** Next file picker opens at that tool's previous PSD folder (`mm_open_psd_last_folder_token`).
- **AUTO PHOTO FILL:** Next photo picker opens at that tool's previous photo folder (`mm_auto_photo_fill_last_folder_token`).
- **SAVE PAGE:** Normal activation opens the compact confirmation dialog at its exact remembered base folder (`mm_save_page_last_folder_token`). A valid token under the former `mm_save_page_base_folder_token` key is migrated once; the old key is removed only after the canonical token is stored successfully.
- **SAVE EDITED PHOTOS:** Normal activation opens the confirmation dialog at its exact remembered destination (`mm_save_edited_photos_folder_token`).
- **SAVE PSD CATEGORY:** Normal activation opens the confirmation dialog at its exact remembered base folder (`mm_save_psd_category_base_folder_token`).
- **Shift+Click**, **Shift+Enter**, and **Shift+Space** use a valid remembered folder directly, skipping all folder UI. First use or a stale token opens the native picker; that selection is used immediately.
- The browser lists child folders alphabetically. Click a folder or activate it with Enter/Space to enter; **BACK** visits only folders traversed in the current session. **CHOOSE OTHER LOCATION** opens the native picker and resets the browser root if a folder is chosen. Cancelling that picker returns to the same browser location.
- **SELECT THIS FOLDER** confirms the remembered Entry without rewriting its token. **CHOOSE OTHER LOCATION** replaces only that tool's token after successful selection; native-picker cancellation restores the confirmation dialog and preserves the prior destination. **CANCEL** aborts the operation. If token creation fails, the selected Entry is still used for this operation and the prior token is retained.
- If a remembered folder is moved, deleted, or inaccessible, the stale token is safely cleared without affecting any other tool.

### 3. FLIP PHOTO Tool
- Horizontally mirrors selected photo layers (Smart Objects or normal pixel photo layers) around each layer's **own center**.
- Multiple selected layers are flipped independently—never treated as a combined transform group.
- Unsupported layers (groups, text, adjustment layers) are safely skipped.
- Preserves layer stack position, clipping masks, effects, Smart Object status, opacity, and blend mode.
- Restores original layer selection and wraps operations into an undoable history step (`Flip Photos`).

### 4. SAVE PSD CATEGORY Tool
Natively ported from legacy JSX (`SAVE_PSD_CATEGORYV 5.0.JSX`) to modular UXP:
- **Document & Selection:** Requires an active document and selected placeholder layers.
- **Categories (12):**
  - `3 PHOTOS PSD` through `12 PHOTOS PSD`
  - `INSTA POST`
  - `RICE CEREMONY`
- **Auto Category Detection:** Automatically preselects `<count> PHOTOS PSD` when 3 to 12 layers are selected.
- **Device Suffix:** Independent device selection dialog (`LT`, `PC`, or `Custom`), remembered under `mm_save_psd_category_device_name`.
- **Orientation Detection & Check:** Calculates layer aspect ratios (Landscape `L`, Portrait `P`, Square `S`), presents an editable confirmation dialog, and prepends non-zero counts in `L_P_S` order (e.g. `2L_1P_`).
- **Category Subfolder & Clean Category:** Saves into `<base>/<category>/` and cleans ` PSD` from category text in filenames (e.g. `MMR 3 PHOTOS`).
- **Max+1 Numbering (Legacy Regex Bug Fixed):** Robust sequence scanner recognizes filenames with prefixes, clean category, sequence number, and device suffix (e.g. `2L_1P_Bride_MMR 3 PHOTOS 01 PC.psd`) without restarting at 01 when prefixes or devices change.
- **PSD Layered Copy:** Saves a complete PSD copy with layers preserved.
- **Safe Optional Original Deletion:** If enabled, after the category PSD is verified saved, prompts with an explicit confirmation dialog before deleting only the original source PSD. Guarded against unsaved documents, target-matches-source collisions, and failed saves.

---

## Stable Tools Overview

### OPEN PSD
- Opens one or multiple album PSD files sequentially.
- Resets rename counter to `01` per document.
- Smart Rename: Normalizes vendor layers matching keywords to `NN MMR | 7001514367`.
- Standardizes DPI and canvas dimensions (36×12 and 18×12 standard spreads).
- Re-establishes clean standard album guides.

### AUTO PHOTO FILL
- Reads selected placeholder dimensions and source photo dimensions.
- Deterministic orientation matching (portrait, landscape, flexible) with stable fallback.
- Places photos as embedded Smart Objects, cover-fitted, centered, and clipped.
- Moves used source photos to `Album Used` in their original folder.

### SWAP PHOTOS
- Directly swaps contents of exactly 2 or 3 selected Smart Object photo layers.
- Direct 2-way swap: `A <-> B`.
- Cyclic 3-way swap: `A <- C, B <- A, C <- B`.
- Preserves layout positions, clipping masks, effects, and layer hierarchy.

### SAVE PAGE
- Saves PSD and JPEG copies into `PSD/` and `JPEG/` subfolders inside the chosen base folder.
- Supports optional sanitized custom prefix (e.g. `Riya_MMRLT1`).
- Offers remembered `PSD ONLY`, `JPEG ONLY`, or `BOTH` output format selection (`mm_save_page_output_mode`, default `both`).
- Scans `MMRLT` serial numbers globally across both PSD and JPEG folders for every format, with collision-safe target creation.
- JPEG exported at maximum Quality 12.

### SAVE EDITED PHOTOS
- Iterates selected Smart Objects, opens PSB contents sequentially, and exports Quality 12 JPEGs into the destination folder.
- Uses shared sequence numbering with device suffix (`LT` / `DT`).
- Closes PSBs without saving changes and restores the original album selection.

### REMOVE PHOTOS
- Recursively deletes child layers matching:
  1. Smart Object
  2. Clipped to layer below
  3. Name substring match (`IMG`, `DSC`, `PHOTO`, `.JPG`, `.JPEG`)
- Non-matching layers, pixel layers, text, and group containers are safely preserved.

---

## Project Structure

- `manifest.json` — Photoshop UXP plugin manifest (`v1.1.0`)
- `index.html` / `style.css` — 2-column responsive layout, inline SVG icons, dialog modals
- `main.js` — Panel event handling, button locking, dialog flow orchestration
- `src/folderMemory.js` — Independent per-tool persistent folder token storage and restoration
- `src/tools/createPage.js` — Creates 300-DPI album/social/custom pages and album-safe guides
- `src/tools/addFrame.js` — Remembered Frame Root Folder, native PSD picker, and editable-group import with fit/center and rollback
- `src/tools/addAsset.js` — Shared PNG MASK / PNG TEXT / CLIP ART configuration, independent folder memory, native PNG selection, embedded placement, fitting and cleanup
- `src/tools/saveFrame.js` — Independent Frame Library Root, photo-count folders, selected-content layered PSD export and safe temporary cleanup
- `src/tools/openPsd.js` — Open PSD workflow with folder memory
- `src/tools/autoPhotoFill.js` — Auto Photo Fill workflow with folder memory
- `src/tools/swapPhotos.js` — Smart Object content swap
- `src/tools/flipPhoto.js` — Horizontal flip around layer center
- `src/tools/savePage.js` — Save Page PSD/JPEG copies with folder memory
- `src/tools/saveEditedPhotos.js` — Save Edited Photos with folder memory
- `src/tools/savePsdCategory.js` — Save PSD Category with auto-count, orientation, and folder memory
- `src/tools/removePhotos.js` — Document-wide clipped photo removal
- `src/licensing/` — Licensing architecture foundation (Phase 1, non-enforcing)
  - `constants.js` — Central licensing keys, intervals, and schema version
  - `licenseState.js` — Explicit states and pure normalization helpers
  - `licenseStorage.js` — Fault-tolerant UXP secureStorage abstraction
  - `licenseManager.js` — Central state machine and controller with dependency injection
- `src/ui/toast.js` — Toast notifications
- `tests/` — Comprehensive Node test suite

---

## Production Licensing Architecture (Phase 2)

The plugin incorporates a production-grade, cryptographically verified offline-first licensing system:

- **Authoritative Backend:** Hosted on Cloudflare Workers at `https://mm-license-server.rammonihalder.workers.dev` backed by Cloudflare D1 authoritative state.
- **Signed-Token Trust Architecture:** The backend issues cryptographically signed `MM1` tokens (`MM1.<kid>.<payloadB64Url>.<sigB64Url>`) signed with an Ed25519 private key. The serialized token header and payload bytes are verified strictly before JSON parsing or schema inspection.
- **Pure-JavaScript Public-Key Verification:** The plugin contains only the public verification key (Ed25519 SPKI DER format) in `src/licensing/productionConfig.js`. Verification is performed locally using a zero-dependency, pure-JavaScript Ed25519 implementation (TweetNaCl) compatible with the Adobe UXP environment without relying on Node.js built-ins (`crypto`, `fs`, `Buffer`) or dynamic code evaluation (`eval`).
- **Strict DER SPKI Parser:** Public keys in SPKI format are strictly validated against ASN.1 DER structure (`1.3.101.112` OID header, exact 44-byte length) to extract the 32-byte raw Ed25519 key.
- **Offline Grace & Refresh Cycle:**
  - **7-day refresh target:** When a verified token's `refreshAfter` timestamp is reached, the plugin attempts an online refresh in the background during initialization.
  - **14-day offline grace:** If the licensing server cannot be reached due to network downtime or offline travel, the license enters `GRACE` state and protected tools remain operational until `graceUntil` expires.
  - **Authoritative denial:** Authoritative server responses (`LICENSE_REVOKED`, `LICENSE_SUSPENDED`, `DEVICE_REVOKED`) immediately revoke access and never enter offline grace.
- **Server-Side Device Limit Enforcement:** Device limits are strictly enforced server-side. Each installation maintains a high-entropy, privacy-friendly opaque installation ID stored in `secureStorage` (never collecting hardware serials, MAC addresses, or personal data).
- **Secure Local Cache Boundary:** `secureStorage` acts strictly as an encrypted local cache. Tokens are verified locally before writing to cache. The plaintext license key entered by the user is never persisted to storage and is cleared from memory and input fields upon activation.
- **Sub-millisecond Tool Execution:** Protected tools check an in-memory verified token snapshot. Normal tool operations never trigger network requests or redundant disk reads.
- **Deactivation:** Users can deactivate their computer via the "Manage License" modal in the panel footer. Successful deactivation contacts the server to free a device activation slot, clears the cached token, and preserves the installation device ID for seamless reactivation.
- **Entitlements Support:** Signed payloads support canonical, deduplicated entitlement arrays (`entitlements`) for optional modules without requiring license key replacements for existing features.

---

## Running Automated Tests

Run all unit tests:

```powershell
node --test
```

The suite includes ADD FRAME persistence/editable-import tests (`tests/addFrame.test.js`), frame dialog tests (`tests/addFrameUi.test.js`), shared PNG import/folder tests (`tests/addAsset.test.js`), category dialog/action tests (`tests/addAssetUi.test.js`), SAVE FRAME export/root/numbering tests (`tests/saveFrame.test.js`) and dialog/protected-action tests (`tests/saveFrameUi.test.js`), all existing tool and licensing suites, and headless browser layout probes. Photoshop-native transparency/editability, undo and cross-restart persistence also require the manual checks above.
