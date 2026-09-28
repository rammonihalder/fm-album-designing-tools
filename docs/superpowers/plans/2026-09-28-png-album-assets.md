# PNG Album Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add PNG MASK, PNG TEXT and CLIP ART to CREATE ALBUM while preserving the working PSD frame workflow and original tools.

**Architecture:** A configured `src/tools/addAsset.js` engine owns category folder memory, native PNG selection and embedded placement. A single new dialog is configured by `main.js`; all three asset buttons use existing license gating and operation locking. PSD group import stays separate and unchanged.

**Tech Stack:** Photoshop UXP API v2, existing CommonJS modules, Node test runner, existing headless browser layout probes.

**Spec:** C:/Users/rammo/.codex/attachments/ba23b7d9-3716-427c-b8cf-436fc88bd665/Pasted text.txt

## Global Constraints

- Keep v1.2.0 DEV, DEV bypass and production licensing unchanged; do not build CCX.
- Preserve ADD FRAME module, dialog, styling, folder memory and tests; preserve Create Page and the eight original tools.
- Asset rows: ADD FRAME + PNG MASK, then PNG TEXT + CLIP ART; existing narrow single-column fallback remains.
- Independent keys: mm_png_mask_folder_token, mm_png_text_folder_token, mm_clip_art_folder_token.
- Native file picker: initialLocation rememberedRoot, types ["png"], allowMultiple false. No custom browser.
- Place embedded PNG Smart Objects without opening or saving source images; uniform downscale only to 80%, center and select.
- One undo operation per import: Add PNG Mask, Add PNG Text, Add Clip Art; rollback partial placement on error.

## Review Focus

- Failure to store a token must retain the previous category root.
- Folder cancellation and file-picker navigation must never change another category or ADD FRAME.
- Captured target must stay the destination even if the active document changes during file selection.
- Placement into an existing selected group must still yield an independent new asset without fitting old layers.
- A native placement error after adding a layer must roll back the partial layer and expose the native cause.

## Task 1: Shared asset engine

**Files:** Create src/tools/addAsset.js and tests/addAsset.test.js.
**Interfaces:** ASSET_CONFIGS keyed by png-mask/png-text/clip-art; runAddAsset({config,showAssetDialog,onResult,photoshop,localFileSystem,storage}); importPngAsset({config,fileEntry,targetDocument,photoshop,localFileSystem}); reusable folder/picker helpers and buildAssetToast.

- [x] Write and run failing tests for independent category memory, cancellation, stale/read-only storage, exact native picker arguments, document capture and import rollback.
- [x] Implement shared engine with category configuration, reused folderMemory primitives, session-token placeEvent, modal/history ownership and fit/center/select.
- [x] Run engine tests, preserving source files, original layers, selection on failure, and correct history names.

## Task 2: Dialog and action integration

**Files:** Modify main.js, index.html and style.css; create tests/addAssetUi.test.js and three PNG icons.
**Interfaces:** promptForAssetDialog({config,folder,folderPath,message}), handleAddAsset(type), pngMaskBtn/pngTextBtn/clipArtBtn UI references; shared assetDialog/assetDialogTitle/assetFolderPath/assetMessage/assetFolderBtn/assetSelectBtn/assetCancelBtn.

- [x] Write and run failing UI tests for exact category labels, first use, restored roots, cancellation, keyboard cleanup, license gating and shared operation lock.
- [x] Add reusable dialog, three matching buttons/icons and protected handlers without refactoring existing handlers or dialogs.
- [x] Run new UI tests and unchanged ADD FRAME/Create Page/licensing tests.

## Task 3: Layout, docs and final verification

**Files:** Modify tests/layout.test.js and README.md.

- [x] Extend real browser probes for both asset rows, full-width Create Page, green styling, no overlap, readable long paths and compact category dialogs; retain original main-grid and frame checks.
- [x] Document CREATE ALBUM categories, independent root keys, embedded placement, fitting, and native Photoshop manual checks; correct the PSD transfer documentation to describe the already-working individual transfer.
- [x] Run node --test and syntax/whitespace checks; compare protected-file hashes with the pre-task backup.
- [x] Request focused read-only review and fix actionable findings; report changed/added files, exact workflow, complete test totals and manual Photoshop checks.

## Execution record

- Implemented in the requested existing DEV checkout, preserving its pre-existing changes; no commit, push or CCX build.
- Engine: 36 tests; category UI/actions: 20 tests; original frame, Create Page and licensing suites retained.
- Headless browser checks and visual inspection verify normal/wide/narrow rows, loaded icons, long paths and category dialogs.
- Review findings fixed with red/green cases: history-finalization cleanup and inherited clipping on the new asset. Read-only re-review found no remaining actionable defects.
- Native Photoshop transparency, Ctrl+T, real undo and cross-restart token behavior are documented manual checks, not claimed as tested here.
