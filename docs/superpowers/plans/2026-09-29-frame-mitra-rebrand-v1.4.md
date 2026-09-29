# Frame Mitra Rebrand v1.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the controlled v1.4.0 Frame Mitra rebrand with exact user-visible copy and FMRLT page output while preserving all MM licensing and persistence compatibility identifiers.

**Architecture:** Keep the existing module boundaries. Update user-visible constants and UI strings in place, isolate the new page filename prefix from the legacy-compatible serial extractor, and extend existing tests with exact-value assertions for branding and compatibility. No licensing protocol or backend implementation changes are permitted.

**Tech Stack:** JavaScript, HTML/CSS, Adobe Photoshop UXP manifest, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-29-frame-mitra-rebrand-v1.4-design.md`

## Global Constraints

- Final brand: `FRAME MITRA`.
- Final product: `FM Album Designing Tools`.
- Final version: `1.4.0`; visible version is `v1.4.0`.
- Developer credit: `Developed by Hridita Innovations`.
- Exact purchase message: `I want to buy a license for FM Album Designing Tools.`
- Keep plugin ID exactly `in.memorymaker.albumplacer`.
- Keep signed token protocol exactly `MM1`.
- Keep secure-storage keys including `mm_license_signed_token_v1`, `mm_license_metadata_v1`, and `mm_license_device_id_v1` unchanged.
- Do not modify backend/server code or licensing endpoints/contracts.
- New page output uses `FMRLT`; scanning recognizes both `MMRLT` and `FMRLT`.
- Do not commit, merge, tag, deploy, or package.

## Review Focus

- A legacy `MMRLT` file must still advance the global serial; test mixed `MMRLT8` and `FMRLT10` to produce `FMRLT11`.
- A collision during FMRLT creation must advance without overwriting; retain the existing collision test and assert the new prefix.
- User-visible rebrand strings must not accidentally alter `MM1`, `mm_*` keys, plugin ID, trial state, or paid-license behavior; add exact invariant assertions in licensing tests.
- Historical/reference and filesystem-path text must not be blindly renamed; test only current user-visible values and audit the final diff.
- The WhatsApp URL must preserve the visible phone and target while changing only the exact message text; test both constant and encoded URL.

---

### Task 1: Update product metadata, UI copy, licensing copy, and logs

**Files:**
- Modify: `manifest.json`
- Modify: `index.html`
- Modify: `main.js`
- Modify: `src/licensing/constants.js`
- Modify: `src/licensing/licenseManager.js`
- Modify: `src/photoshop.js`
- Modify: `src/tools/autoPhotoFill.js`, `src/tools/openPsd.js`, `src/tools/swapPhotos.js`
- Modify: relevant UI/licensing tests under `tests/`

**Interfaces:**
- Consumes: existing manifest/runtime constants and UI selectors.
- Produces: exact v1.4.0 metadata and user-visible Frame Mitra strings while exporting the same licensing APIs and identifiers.

- [ ] **Step 1: Write/update failing exact-value tests** for manifest name/version, visible `v1.4.0`, `FRAME MITRA`, `FM Album Designing Tools`, license dialog copy, developer credit, runtime `PLUGIN_VERSION`, exact purchase message/URL, and Frame Mitra log labels.
- [ ] **Step 2: Run the focused UI/licensing tests** and confirm failures are caused by old branding/version values.
- [ ] **Step 3: Implement the minimal metadata/copy changes**. Change only current user-visible branding and logs; leave plugin ID, `MM1`, secure-storage keys, API contracts, and trial/paid behavior unchanged.
- [ ] **Step 4: Run the focused tests** and confirm they pass with no compatibility failures.

### Task 2: Implement FMRLT output with MMRLT backward-compatible scanning

**Files:**
- Modify: `src/tools/savePage.js`
- Test: `tests/savePage.test.js`
- Test: related page/dialog/layout/toast tests only where expected generated output is asserted.

**Interfaces:**
- Consumes: existing `extractAlbumSerial`, `getNextPageNumber`, `buildPageBaseName`, and collision-safe `resolveSafeFileEntries` flow.
- Produces: `SERIAL_REGEX`/serial extraction that recognizes both prefixes and `buildPageBaseName` that emits `FMRLT`.

- [ ] **Step 1: Add failing tests** for FMRLT extraction, FMRLT generation with and without custom prefix, mixed `MMRLT8 + FMRLT10 -> FMRLT11`, and no-overwrite behavior.
- [ ] **Step 2: Run `node --test tests/savePage.test.js`** and confirm the new expectations fail against MMRLT-only generation.
- [ ] **Step 3: Implement the minimal prefix split**: recognize `MMRLT` and `FMRLT` in supported extensions, compute the highest occupied serial across both folders, and generate only FMRLT names.
- [ ] **Step 4: Run the focused save-page tests** and confirm all pass.

### Task 3: Update generated user-visible layer/photo branding and documentation

**Files:**
- Modify: `src/tools/saveEditedPhotos.js`
- Modify: `src/photoshop.js` if layer naming is covered there
- Modify: `README.md`
- Modify: `DEV_UI_FIX_README.txt` only for current user-visible product naming/version
- Preserve: `reference-original.jsx` historical/reference wording and technical filesystem examples unless the audit proves they are current UI.

**Interfaces:**
- Consumes: existing edited-photo filename extraction/generation and documentation text.
- Produces: Frame Mitra user-visible generated names and current v1.4.0 documentation without changing technical storage keys or historical compatibility.

- [ ] **Step 1: Add/update failing tests** for new `Frame Mitra <n> LT/DT.jpg` output and recognition of existing legacy `Memory Maker <n> LT/DT.jpg` names, plus current README/product copy where tests exist.
- [ ] **Step 2: Run the focused edited-photo tests** and confirm old branding expectations fail.
- [ ] **Step 3: Implement the minimal new-name/legacy-scan behavior** and update current documentation/attribution wording.
- [ ] **Step 4: Run focused edited-photo and documentation assertions** and confirm they pass.

### Task 4: Full audit and verification

**Files:**
- Modify: only tests needed to encode the approved exact values and compatibility invariants.

**Interfaces:**
- Consumes: completed source changes from Tasks 1–3.
- Produces: an auditable working tree and test evidence.

- [ ] **Step 1: Run the required repository search audit** for branding, `MMRLT`, `MM1`, `mm_license_`, and plugin ID; classify remaining matches as current user-visible, backward-compatible generated filename, or technical compatibility/history.
- [ ] **Step 2: Run `node --test`** from the project root and record total/pass/fail/cancelled/skipped counts.
- [ ] **Step 3: Inspect `git diff --check`, `git diff --stat`, and `git status --short --branch`**; verify no backend files or unrelated pre-existing edits were discarded.
- [ ] **Step 4: Report changed files, every user-visible branding change, exact metadata/copy, compatibility confirmations, FMRLT behavior, test totals, Git status, and explicitly confirm no commit/merge/tag/deploy/package occurred.

