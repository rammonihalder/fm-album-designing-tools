# Adjust Light: development-only feature

QUICK EDIT fourth tile replaces the inactive Auto White Balance tile with Adjust Light.

- Brightness slider: -100 to +100 Photoshop Brightness values (0 neutral).
- No live host preview while dragging; Apply runs a non-destructive Brightness/Contrast adjustment (contrast=0).
- Existing FM Adjust Light [FMQE] layer is updated rather than duplicated.
- Embedded photo Smart Objects in Album PSD: open owned inner PSB, update composite adjustment, save/close owned PSB, restore Album selection.
- Direct user-opened PSB: update composite adjustment but never automatically save/close it.
- Reset changes slider to zero; click Apply to neutralize an existing FM Adjust Light adjustment. Cancel never edits Photoshop.
- Multiple selected embedded Smart Objects all receive the same chosen value.
- Auto White Balance is no longer displayed or wired to any UI; the inactive experimental module is retained in source for historical tests.
- Photoshop native host validation still required: appearance of +/- values, repeated Apply, error rollback and dialog usability.
- Keep marketplace v1.4.2, manifest and licensing unchanged. Do not merge or package for publication.
