# MM Album Design Tools v1.0.0

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

- `manifest.json` — Photoshop UXP plugin manifest (`v1.0.0`)
- `index.html` / `style.css` — 2-column responsive layout, inline SVG icons, dialog modals
- `main.js` — Panel event handling, button locking, dialog flow orchestration
- `src/folderMemory.js` — Independent per-tool persistent folder token storage and restoration
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

## Licensing Foundation

- **Phase 1 Only:** Establishes an isolated plugin-side architectural foundation for future licensing capabilities.
- **Secure Local Token Cache Architecture:** Built around UXP `secureStorage` as an encrypted local cache for future signed tokens rather than treating local storage as an authoritative license state.
- **Licensing Is Not Yet Enforced:** The licensing manager operates in an unactivated baseline state without blocking or restricting any plugin actions.
- **No Backend / Network Validation Yet:** No network permissions, backend URLs, or remote verification calls exist in this phase.
- **Existing Tools Remain Operational:** All eight tools attach and execute normally with zero behavioral changes or performance overhead.
- **Cryptographic Trust Boundary:** When Phase 2 introduces online activation, cryptographically verified server-issued signed tokens will serve as the sole authoritative trust boundary.

---

## Running Automated Tests

Run all unit tests:

```powershell
node --test
```

All automated unit tests pass across all tool suites, licensing foundation tests, and layout probes.

