# FM Album Designing Tools v1.4.1

**Brand:** Frame Mitra | **Developer:** Hridita Innovations

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

## What's New in v1.3.0

### 30-Day Full-Feature Free Trial
- **Explicit User Activation:** Trial starts only when the user explicitly clicks **START TRIAL** (or **START 30-DAY FREE TRIAL** in the License Management dialog).
- **Online Initialization:** Internet connectivity is required to start the trial; server time is strictly authoritative.
- **Exact 30-Day Duration:** Trial duration is exactly 30 days from the moment of activation (`started_at` to `expires_at = started_at + 30 days`).
- **Device-Bound Protection:** Each trial is bound to one opaque installation device identity. Reopening Photoshop or reloading the plugin does not reset trial time.
- **Anti-Reset Expiry Enforcement:** Re-requesting trial start or refreshing an active trial token returns the original server-controlled expiry; trial duration can never be extended by token refreshes or repeated clicks.
- **Offline Resilience:** Once started, the trial continues to work completely offline until its original signed 30-day expiry date.
- **Strict Expiry & Zero Grace:** The trial has zero extra grace period after day 30. Once expired, operational access is immediately blocked until a license is activated.
- **Full Feature Parity:** The trial provides unrestricted access to all plugin features and tools without watermarks or per-tool locks.
- **Seamless Paid Upgrades:** Users can activate a paid license key at any time during an active trial without needing to deactivate the trial first.
- **Backward Compatibility:** Existing paid v1.2.0 users remain fully activated and operational upon upgrading to v1.3.0 without re-entering license keys.

### Compact Bottom License Status UI
A compact, user-friendly status area is located at the bottom of the main plugin panel:
- **`Activated License` (Green):** Indicates an active or grace-period paid license. Clickable to open License Management.
- **`Start Trial` (Green Button):** Displayed on unactivated installations where a trial has not yet been started. Clicking starts the 30-day trial with real-time feedback.
- **`Trial Active • N Days Left` (Amber/Orange):** Informational status displaying the remaining days of an active trial (clamped 0 to 30). Clickable to open License Management.
- **`Please Add License` (Red):** Displayed when a trial has ended or when license activation is required to unlock tools. Clickable to open License Management dialog.
- **Privacy & Accessibility:** Keyboard-navigable (Enter/Space activation), high-contrast, compact, and free of technical internal error codes or hardware fingerprints.

### Paid-Deactivation Trial Restoration
- **Intelligent Trial History:** The plugin maintains a non-authoritative local history marker (`trialPreviouslyStarted`) to safely determine post-deactivation behavior without granting local authority.
- **Never-Used-Trial Devices:** Users who activate a paid license without ever starting a trial return to `UNACTIVATED` upon deactivation, displaying `Start Trial`. No trial is consumed or started automatically.
- **Active Trial Resumption:** If an active trial was superseded by a paid license, deactivating the paid license before the trial's original expiration safely restores the original trial with its exact original expiry date (no extra days granted).
- **Expired Trial Handling:** If the original trial expired while the paid license was active, deactivation correctly transitions to `TRIAL_EXPIRED`, displaying `Please Add License` in red, hiding `Start Trial`, and blocking tool access.
- **Fail-Closed Security:** In the event of network failure during trial restoration, the plugin fails closed, keeping tools securely locked until online validation succeeds.

### Purchase & Renewal Contact UI (WhatsApp Integration)
- **Direct Administrator Contact:** When a trial or paid license expires, the License Management dialog provides a clear contact and renewal area displaying the administrator phone number: `7001514367`.
- **CONTACT ADMIN Action:** A dedicated, keyboard-accessible button launches WhatsApp with the administrator (`+91 7001514367`) and pre-fills the message:
  `I want to buy a license for FM Album Designing Tools.`
- **Programmatic URL Generation:** Constructed safely via standard UXP external opening protocols (`https://wa.me/917001514367?text=...`) using `encodeURIComponent` without invoking command shells or spawning external processes.
- **Non-Fatal Fallback:** If WhatsApp fails to launch, the dialog displays a friendly fallback notice (`Unable to open WhatsApp. Please contact 7001514367 manually.`) while keeping the phone number clearly visible.
- **Manual Send Protection:** The user retains full control and must manually click "Send" within WhatsApp; the plugin never auto-sends messages.

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

### CREATE ALBUM layout and assets

CREATE PAGE remains the full-width first action below the original eight-tool grid. The green tool buttons use four rows:
- **[ ADD FRAME ] [ SAVE FRAME ]**
- **[ ADD ASSET ] [ SAVE ASSET ]**
- **[ PNG MASK ] [ PNG TEXT ]** (legacy individual tools preserved for migration)
- **[ CLIP ART ] [ CHANGE BACKGROUND ]**

| Action | Asset / result | Root key | Select / Action label |
| --- | --- | --- | --- |
| CREATE PAGE | Preset or custom album/social canvas | None | Existing page presets |
| ADD FRAME | PSD contents as editable grouped layers | `mm_add_frame_folder_token` | SELECT PSD FRAME |
| SAVE FRAME | Selected layers/groups exported as a layered PSD | `mm_save_frame_root_folder_token` | SAVE FRAME |
| ADD ASSET | Transparent PNG asset imported as Embedded Smart Object | `mm_asset_library_root_folder_token` | SELECT ASSET |
| SAVE ASSET | Selected layers/groups exported as trimmed transparent PNG | `mm_asset_library_root_folder_token` | SAVE ASSET |
| CHANGE BACKGROUND | Cover-fitted background image replaced at bottom of stack | `mm_background_folder_token` | SELECT BACKGROUND |
| PNG MASK | Transparent PNG as an embedded Smart Object | `mm_png_mask_folder_token` | SELECT PNG MASK |
| PNG TEXT | Transparent PNG graphic as an embedded Smart Object | `mm_png_text_folder_token` | SELECT PNG TEXT |
| CLIP ART | Transparent PNG as an embedded Smart Object | `mm_clip_art_folder_token` | SELECT CLIP ART |

### Reusable Asset Library (ADD ASSET / SAVE ASSET)

The **ADD ASSET** and **SAVE ASSET** tools form a unified reusable asset-library workflow sharing one common Asset Library Root folder.

#### Shared Root Folder & Categories

- **Storage Key:** `mm_asset_library_root_folder_token` (shared between ADD ASSET and SAVE ASSET, independent of frame tools and legacy PNG tools).
- **Categories:**
  1. `PNG TEXT`
  2. `PNG ASSET` (default)
  3. `DECORATION`
  4. `PNG BORDER`
  5. `PNG MASK`
- **Folder Structure:** Inside the Asset Library Root (e.g. `D:\Memory Maker\PNG Assets\`), category folders are automatically resolved and created on demand:
  ```
  D:\Memory Maker\PNG Assets\
      PNG TEXT\
      PNG ASSET\
      DECORATION\
      PNG BORDER\
      PNG MASK\
  ```

#### SAVE ASSET Workflow

1. User opens any market or template PSD.
2. User selects one or more graphic layers or groups.
3. User clicks **SAVE ASSET**.
4. A compact dialog opens displaying the current **ASSET LIBRARY ROOT** (or "No asset library folder selected" with **SET FOLDER**), a **CATEGORY** dropdown defaulting to **PNG ASSET**, **[ SAVE ASSET ]** (disabled until a root is configured), and **[ CANCEL ]**.
5. When saved:
   - Duplicate only the selected layers/groups into a temporary document.
   - Preserve their relative positions, masks, and visible effects (shadows, glows, strokes, transforms).
   - Perform a transparent pixel trim on all four sides (`Image > Trim > Transparent Pixels`).
   - Export as a transparent PNG into `<Root>\<CATEGORY>\<filename>.png`.
   - Numbering is automatic, category-specific (`mm_text01.png`, `mm_asset01.png`, `mm_decoration01.png`, `mm_border01.png`, `mm_mask01.png`), 2-digit zero-padded (`01`–`99`) or natural larger numbering (`100+`), per-category, ignores unrelated PNG files, and never overwrites existing files.
   - Temporary document closes without saving.
   - Source document is completely unchanged, and source layer selection is restored.
   - Success toast: `Saved asset: <CATEGORY> / <filename>` (e.g., `Saved asset: PNG TEXT / mm_text03.png`).

#### ADD ASSET Workflow

1. User opens or creates an album page.
2. User clicks **ADD ASSET**.
3. A compact dialog opens with **ASSET LIBRARY ROOT**, **CATEGORY** dropdown defaulting to **PNG ASSET**, **[ SELECT ASSET ]** (disabled if no root), and **[ CANCEL ]**.
4. Clicking **[ SELECT ASSET ]** ensures the category folder exists and opens Photoshop's native file picker filtered to PNG files (`initialLocation: categoryFolder`, `types: ["png"]`, `allowMultiple: false`).
5. Upon selection:
   - Placed into active document as an **Embedded Smart Object** (`batchPlay` `placeEvent` with `linked: false`).
   - Preserves alpha transparency.
   - Preserves aspect ratio.
   - Centered on canvas.
   - Proportionally scaled down only if larger than 80% of canvas width or height; smaller assets are never enlarged.
   - Placed on an independent layer at the top, clearing any inherited clipping.
   - Layer named using the filename without extension (e.g., `mm_asset14.png` -> `mm_asset14`).
   - Placed layer remains selected for immediate `Ctrl+T` transform.
   - Wrapped under single-step undo history named `Add Asset`.

PNG placement uses an embedded `placeEvent` with a UXP session token and `linked: false`, without opening or saving the source PNG. Each new layer receives the filename without `.png`, stays independent of existing groups, is uniformly scaled down only if it exceeds 80% of the canvas width or height, and is centered and selected for Ctrl+T. Small assets are not enlarged. PNG MASK does not create a clipping mask; PNG TEXT remains a graphic, with no OCR or editable-text conversion; CLIP ART has no special clipping behavior. ADD FRAME continues using its separate editable PSD group importer.

Each PNG import runs in one modal/history operation: **Add PNG Mask**, **Add PNG Text**, or **Add Clip Art**. Failed placement/transforms roll back partial additions and log the native error. The central license gate, running lock, and v1.2.0 production release apply to all three tools.

#### CHANGE BACKGROUND

- **Workflow:**
  1. User opens an album PSD (checks for active document; reports `Create or open a page first.` if missing).
  2. User clicks **CHANGE BACKGROUND**.
  3. A compact dialog opens showing **BACKGROUND FOLDER** (or `No background folder selected`), **[ SET FOLDER / CHANGE FOLDER ]**, **[ SELECT BACKGROUND ]** (disabled if no folder configured), and **[ CANCEL ]**.
  4. **Dedicated Root Memory:** Remembers folder using `mm_background_folder_token`, independent of frame roots, asset library root, and legacy tools. Stale tokens are safely cleared without touching other tools.
  5. **File Selection:** Opens native picker filtered to JPG, JPEG, and PNG (`types: ["jpg", "jpeg", "png"]`, `allowMultiple: false`), starting at the remembered root folder. Navigating elsewhere never changes the configured root.
  6. **Bottom-Most Top-Level Layer Detection:** The bottom-most top-level layer in the document is ALWAYS the background to replace (`targetDocument.layers[targetDocument.layers.length - 1]`). Never inspects name or rejects by layer kind (handles `Background`, `Layer 0`, `BG`, `IMG...`, `DSC...`, Smart Objects, normal pixel layers, shapes, groups, text, etc.). Never recurses into nested groups. If the document has zero layers, reports `No layer available to replace.`
  7. **Placement & Cover Fit:** Places the selected image as an Embedded Smart Object (`linked: false`) named without extension (e.g. `Dark Garden 04.jpg` -> `Dark Garden 04`). Scales the image using **COVER** behavior (`scale = max(canvasWidth / imageWidth, canvasHeight / imageHeight)`) so the entire canvas is filled without aspect-ratio distortion or empty borders, then centers the image.
  8. **Stack Ordering & Safe Removal:** Clears inherited clipping (`isClippingMask = false`, `grouped = false`). Moves the new background immediately above the old bottom layer first. Then removes the old bottom layer (safely unlocking it or using batchPlay fallback if it is a locked Photoshop Background layer). The new background naturally becomes the bottom-most top-level layer. Any failure prior to old layer removal cleans up the placed layer and keeps the old bottom layer untouched.
  9. **True Background Layer Conversion:** As the final step after the old bottom layer has been deleted, converts the new layer into a true Photoshop Background Layer using Photoshop's native batchPlay `make backgroundLayer` command (equivalent to `Layer > New > Background from Layer`). If conversion fails, the new background is kept intact at the bottom and a non-fatal warning is returned: `Background changed, but could not convert it to a Background layer.`
  10. **Single-Step Undo:** Entire operation runs under one modal history operation named `Change Background` for seamless `Ctrl+Z` restoration.

#### SAVE FRAME

Open a market/source PSD and select the frame layers or groups to keep. **SAVE FRAME** opens a compact dark dialog with **FRAME LIBRARY ROOT**, **SET FOLDER / CHANGE FOLDER**, **NUMBER OF PHOTOS**, **SAVE FRAME** and **CANCEL**. The dropdown offers **1 PHOTOS** through **12 PHOTOS**, defaulting to **3 PHOTOS**. Escape cancels, buttons support Enter/Space, and long paths keep their full tooltip. Without a root, the path says **No frame library folder selected** and SAVE FRAME is disabled.

Set the library root with the native UXP folder picker. Its dedicated persistent key, `mm_save_frame_root_folder_token`, is independent of every other tool. Cancelled folder changes keep the old root; successful changes update the path immediately. Stale roots clear only this key. The chosen photo count survives folder changes within the dialog.

Saving to **5 PHOTOS**, for example, uses `<root>/5 PHOTOS/`, automatically creating that subfolder if missing and reusing it otherwise. Each folder has its own sequence: **Frame 001.psd**, **Frame 002.psd**, etc. The highest matching PSD number plus one is padded to at least three digits; existing files are never overwritten. The optional custom prefix is omitted in this release.

`src/tools/saveFrame.js` captures the source/selection before configuration, creates a transparent temporary document with the source's full width, height, PPI and practical color mode, and duplicates only the selected native layers/groups individually from bottom to top. A selected group includes its nested content; selecting both a group and its descendant does not duplicate the child twice. Native duplication retains editable text, Smart Objects, masks, effects and other supported layer properties. The exporter preserves positions without scaling, flattening or rasterizing, removes the temporary empty layer, trims the temporary document's transparent canvas to the actual visible non-transparent content bounds (equivalent to Photoshop `Image > Trim > Transparent Pixels` on Top, Bottom, Left, and Right), preserving all selected layers/groups as editable layers and preserving visible drop shadows, outer glows, strokes, masks, and transformed content without preserving unnecessary empty 12x36, 12x18 or source-document canvas size, and calls Photoshop `saveAs.psd(file, { layers: true, embedColorProfile: true }, true)`. RGB, CMYK, grayscale and Lab are supported creation modes; unsupported modes use RGB without changing the source. Supported 8/16/32-bit depth, color profile and pixel aspect ratio are also carried over. Clipping is retained when its actual base is also selected and the original relationship can be preserved; otherwise the selected content exports standalone without borrowing unselected layers. Adjustment appearance also depends on which related layers are selected.

Only the owned temporary document is closed without further saving. Source layers remain unchanged, and source focus and original selection are restored. Failed saves clean up their unfinished file and temporary document, log native errors, and retain a useful error in the configuration dialog for retry. No document reports **Open a PSD first.**; no selection reports **Select one or more frame layers first.** Success closes the workflow and reports, for example, **Saved frame: 3 PHOTOS / Frame 004.psd**. SAVE FRAME uses the existing shared running lock, central license gate, and production licensing in **v1.2.0**.

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
10. Recheck CREATE PAGE, ADD FRAME, all three PNG tools and the original eight actions. While SAVE FRAME is open/saving, confirm conflicting buttons stay locked; verify normal licensing with active and unlicensed states.

#### PNG asset manual Photoshop verification

1. Reload the unpackaged plugin and confirm CREATE PAGE spans the first row, followed by ADD FRAME / SAVE FRAME, PNG MASK / PNG TEXT and CLIP ART / empty slot below the original tools. Confirm all original tools and ADD FRAME still work.
2. For each PNG category, open its dialog with no saved root. Confirm its exact heading and SELECT label, **No folder selected**, SET FOLDER, disabled SELECT, CANCEL, Escape and Enter/Space behavior. Cancel SET FOLDER and confirm no token is saved.
3. Set three different roots; confirm the immediate path/tooltip, CHANGE FOLDER and enabled SELECT. Reopen the panel, reload the plugin and restart Photoshop; confirm all three roots and the ADD FRAME root remain independent. Cancel CHANGE, then successfully change one root, and confirm the other roots are untouched. Move/delete one root and confirm only that category returns to SET FOLDER.
4. Confirm each native picker starts at its own root, filters PNG and allows one selection. Cancel to return to configuration. Navigate elsewhere and import a PNG; reopen and confirm the original configured root is unchanged. With no page open, confirm the exact warning and no picker.
5. Import transparent PNGs in all three categories, including PNG text artwork and a mask. Confirm filename layer names, transparent edges, Embedded Smart Object status, no clipping or OCR, independence from an already-selected album group/clipping stack, preservation of existing clipping relationships, and that source PNGs remain unchanged.
6. Test large landscape/portrait and small PNGs. Confirm equal X/Y scaling down only, 80% maximum coverage, centering and selection. Use Ctrl+T to move/resize/rotate; undo the transform, then undo the category import once and confirm the complete asset disappears.
7. Try a corrupt PNG and simulate a placement/transform failure. Confirm a category-specific error, native console diagnostics, no broken new layers and the original album still active. Attempt another tool during import and confirm the shared lock prevents conflicting operations.

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
- ADD FRAME uses the existing central action handlers, button locking, and production licensing. This is **v1.2.0**.

#### Photoshop manual verification
1. Reload the unpackaged plugin. Verify the existing CREATE ALBUM layout, CREATE PAGE presets/custom page, all eight original tools, and v1.2.0 version.
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
- **OPEN PSD:** remembers the last successfully selected PSD folder (`mm_open_psd_last_folder_token`).
- **AUTO PHOTO FILL:** remembers the last successfully selected photo folder (`mm_auto_photo_fill_last_folder_token`).
The two memories are independent and survive panel/plugin/Photoshop restart through UXP persistent folder tokens.
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
- `src/licensing/` — Production licensing runtime and verification
  - `constants.js` — Central licensing keys, intervals, and schema version
  - `licenseState.js` — Explicit states and pure normalization helpers
  - `licenseStorage.js` — Fault-tolerant UXP secureStorage abstraction
  - `licenseManager.js` — Central state machine and controller with dependency injection
- `src/ui/toast.js` — Toast notifications
- `tests/` — Comprehensive Node test suite

---

## Production Licensing Architecture

The plugin incorporates a production-grade, cryptographically verified offline-first licensing system:

- **Authoritative Backend:** Hosted on Cloudflare Workers at `https://mm-license-server.rammonihalder.workers.dev` backed by Cloudflare D1 authoritative state.
- **Signed-Token Trust Architecture:** The backend issues cryptographically signed `MM1` tokens (`MM1.<kid>.<payloadB64Url>.<sigB64Url>`) signed with an Ed25519 private key. The serialized token header and payload bytes are verified strictly before JSON parsing or schema inspection.
- **Pure-JavaScript Public-Key Verification:** The plugin contains only the public verification key (Ed25519 SPKI DER format) in `src/licensing/productionConfig.js`. Verification is performed locally using a zero-dependency, pure-JavaScript Ed25519 implementation (TweetNaCl) compatible with the Adobe UXP environment without relying on Node.js built-ins (`crypto`, `fs`, `Buffer`) or dynamic code evaluation (`eval`).
- **Strict DER SPKI Parser:** Public keys in SPKI format are strictly validated against ASN.1 DER structure (`1.3.101.112` OID header, exact 44-byte length) to extract the 32-byte raw Ed25519 key.
- **30-Day Full-Feature Free Trial:**
  - Started exclusively via user action (**START TRIAL** or dialog action).
  - Online requirement for initialization with server-authoritative timestamps.
  - Exactly 30 days of full, unrestricted access to all plugin features (`expiresAt = started_at + 30 days`).
  - Bound to one persistent opaque installation device identity.
  - Anti-reset protection: repeated start requests or token refreshes retain original server-side expiry and never grant additional days.
  - Zero extra grace period after day 30: `graceUntil` equals `expiresAt`, blocking tools immediately upon expiry.
  - Offline operation supported throughout the 30-day window without continuous network requirements.
  - Upgrade-ready: users can activate a full paid license at any time to transition directly to `ACTIVE` status.
- **Offline Grace & Refresh Cycle (Paid Licenses):**
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
