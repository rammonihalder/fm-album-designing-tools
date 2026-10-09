# QUICK EDIT Photoshop validation

The Node.js suite simulates Photoshop. It cannot establish that the recorded correction descriptors work in Photoshop, that Smart Object metadata has the expected shape, or that the album visibly changes.

## Load the development panel

The installed Marketplace v1.4.2 copy at `%APPDATA%\Adobe\UXP\Plugins\External\9beaddeb_1.4.2` does not contain QUICK EDIT. This branch has one QUICK EDIT section below CREATE ALBUM in `index.html`; `manifest.json` points to that file. Leave the installed release untouched. In Adobe UXP Developer Tool, add **this working tree's `manifest.json`**, select Photoshop, then **Load** the development plugin. Use **Reload** after source edits, or **Watch**. Check the developer console for `main.js loaded` and missing-button errors. Confirm the static QUICK EDIT section and all four controls are visible without clicking a disclosure; White Balance remains disabled. Adobe documents the [Load, Reload, and Watch workflow](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/plugin-workflows).

The earlier collapsible UI was withdrawn after a reported Photoshop crash on expansion. Its cause is not established by the available UXP logs. Do not reopen that version to reproduce the crash or risk unsaved work. Check the static panel first with no important document open, then use disposable copies for correction tests.

## Album workflow checks

Use disposable copies of albums and Photoshop 25 or later. `Document.selection.bounds` is documented from Photoshop 25.0; older hosts should fail closed rather than create a masked adjustment layer.

1. Open an Album PSD containing two *different embedded* photo Smart Object layers. Select one in the Album PSD; do not open its PSB manually. Click **Auto Brightness / Contrast**. Confirm the plugin opens that layer's contents, creates `FM Auto Brightness/Contrast [FMQE]` clipped directly above the inner photo, saves and closes only the inner PSB, returns to the Album PSD, and preserves the original photo pixels. Check the visible album result and any error.
2. Repeat the action. Confirm it updates that exact plugin layer with no second correction layer. Repeat independently for **Auto Levels** and **Auto Curves**. Inspect the resulting adjustment settings and visual effect.
3. Select both different embedded photo Smart Objects and run one action. Confirm sequential processing, correct per-photo counts, original album selection restored, and no automatic Album PSD save or close.
4. Test a selected nested photo inside a group, a group itself, the album background, a text layer, and a linked Smart Object. Unsupported selections should be reported and left alone; valid selected photos may still process.
5. Duplicate a Smart Object normally so the two instances share contents. Confirm both are rejected with no inner save. The implementation reads `smartObject.linked` and `smartObjectMore.ID` from layer descriptors and fails closed if that metadata cannot be read. Verify these fields and identity behavior on the actual host.
6. Manually open a selected Smart Object's PSB first, then run QUICK EDIT from the album. Confirm the plugin refuses to save or close that pre-existing document. Close it manually afterward.
7. Test an inner PSB with multiple plausible image layers, an active pixel selection, and a user-created adjustment matching an old plugin name. Confirm no uncertain layer is overwritten or saved.
8. Inject or reproduce a correction descriptor error, save error, cancellation, and close failure on disposable files. Confirm that a failed correction is never counted as saved, plugin-owned unsaved PSBs are closed when possible, remaining photos are reported as unprocessed when cleanup is uncertain, and original album selection is restored when Photoshop permits it.

For every action record: whether Photoshop accepted each descriptor, whether the intended inner PSB and album changed, whether the result is visible, which documents remained open, and the exact error. **Saved inner documents are separate operations; a later failure does not undo earlier saves.** The parent Album PSD is never saved or closed by QUICK EDIT.

## Auto White Balance

The recorded Camera Raw action combined `$WBal: auto` with fixed `$Temp: -32` and `$Tint: -14`. That does not establish image-dependent automatic White Balance. QUICK EDIT keeps the control disabled. A future host probe should compare recordings from photos with different color casts, then prove that replay on a third photo recalculates without fixed Temperature/Tint and remains an editable Camera Raw Smart Filter on a duplicate Smart Object.

References: [Adobe Camera Raw white balance](https://helpx.adobe.com/ee/camera-raw/desktop/using/make-color-tonal-adjustments-camera.html), [Smart Filters](https://helpx.adobe.com/photoshop/using/applying-smart-filters.html), [Selection bounds](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/selection/), [batchPlay](https://developer.adobe.com/photoshop/uxp/ps_reference/media/batchplay/), and [modal history/cancellation](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal).
