# SAVE FRAME implementation

Preserve the current v1.2.0 DEV workspace and all existing tool engines. Add SAVE FRAME beside ADD FRAME, followed by PNG MASK / PNG TEXT and CLIP ART / an empty future slot.

1. Add failing engine and UI tests for independent root memory, explicit folder selection, photo-count destination, selected-content export, numbering, cleanup, protected actions and keyboard handling.
2. Implement `src/tools/saveFrame.js`. Capture the source and selection before dialogs; normalize selections to source stack order, avoiding duplicate descendants of selected groups. Create a transparent document with the source canvas/PPI/mode, duplicate selected items individually from bottom to top, remove only the temporary empty layer, save a layered PSD and close only the owned document. Restore source focus and selection on every path.
3. Add the compact root/count dialog and green action to the existing shared operation lock and license wrapper. Keep all existing dialogs and handlers unchanged.
4. Add the SAVE FRAME README workflow and Photoshop checklist. Verify real browser layout at normal, wide and narrow panel sizes; run `node --test` and check protected-file hashes against the task backup.
5. Request a read-only review, resolve actionable findings and rerun affected/full verification as needed. Report native Photoshop checks as pending unless actually performed.

File reservation uses `createFile(..., { overwrite: false })`. Numbering is the highest matching Frame serial plus one in the selected category, padded to at least three digits. Failed exports delete only their own newly created file. No optional prefix, packaging, version or licensing changes.
