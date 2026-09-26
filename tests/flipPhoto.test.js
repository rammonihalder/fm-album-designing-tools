"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSmartObjectLayer,
  isGroupLayer,
  isTextLayer,
  isEligibleFlipLayer,
  buildFlipPhotoToast,
  executeFlipPhotos
} = require("../src/tools/flipPhoto");

function createMockLayer({ id, name = "Layer", kind = 5, isBackground = false, typename = "ArtLayer" } = {}) {
  let rasterized = false;
  return {
    id,
    name,
    kind,
    typename,
    isBackgroundLayer: isBackground,
    get rasterized() { return rasterized; },
    rasterize() { rasterized = true; }
  };
}

test("1. No document: returns outcome no-document and warning toast", async () => {
  const result = await executeFlipPhotos({
    getActiveDocument: () => null
  });

  assert.equal(result.outcome, "no-document");
  assert.equal(result.success, false);
  const toast = buildFlipPhotoToast(result);
  assert.equal(toast.message, "Open a document first");
  assert.equal(toast.type, "warning");
});

test("2. No selected layers: returns outcome no-eligible and warning toast", async () => {
  const doc = { id: 10, name: "Test.psd", activeLayers: [] };
  const result = await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => []
  });

  assert.equal(result.outcome, "no-eligible");
  assert.equal(result.success, false);
  const toast = buildFlipPhotoToast(result);
  assert.equal(toast.message, "Select photo layer first");
  assert.equal(toast.type, "warning");
});

test("3. One selected Smart Object flips successfully", async () => {
  const layer = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });
  const flippedIds = [];
  const doc = { id: 1, activeLayers: [layer] };

  const result = await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [layer],
    flipLayerHorizontal: async l => {
      flippedIds.push(l.id);
    },
    selectLayersByIds: async () => {}
  });

  assert.equal(result.success, true);
  assert.equal(result.flippedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(flippedIds, [101]);

  const toast = buildFlipPhotoToast(result);
  assert.equal(toast.message, "1 photo flipped");
  assert.equal(toast.type, "success");
});

test("4. Multiple selected Smart Objects: all flip successfully", async () => {
  const l1 = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });
  const l2 = createMockLayer({ id: 102, name: "Photo 2", kind: "smartobject" });
  const l3 = createMockLayer({ id: 103, name: "Photo 3", kind: 5 });
  const flippedIds = [];
  const doc = { id: 1 };

  const result = await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [l1, l2, l3],
    flipLayerHorizontal: async l => {
      flippedIds.push(l.id);
    },
    selectLayersByIds: async () => {}
  });

  assert.equal(result.success, true);
  assert.equal(result.flippedCount, 3);
  assert.equal(result.skippedCount, 0);
  assert.deepEqual(flippedIds, [101, 102, 103]);

  const toast = buildFlipPhotoToast(result);
  assert.equal(toast.message, "3 photos flipped");
  assert.equal(toast.type, "success");
});

test("5. Each layer flips independently around its own center", async () => {
  const l1 = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });
  const l2 = createMockLayer({ id: 102, name: "Photo 2", kind: 5 });
  const calls = [];
  const doc = { id: 1 };

  await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [l1, l2],
    selectLayerById: async id => {
      calls.push({ action: "select", id });
    },
    flipLayerHorizontal: async l => {
      calls.push({ action: "flip", id: l.id });
    },
    selectLayersByIds: async () => {}
  });

  // Verify that each layer is processed as its own flip invocation
  const flips = calls.filter(c => c.action === "flip");
  assert.equal(flips.length, 2);
  assert.equal(flips[0].id, 101);
  assert.equal(flips[1].id, 102);
});

test("6. Selection is restored at the end to original selected IDs", async () => {
  const l1 = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });
  const l2 = createMockLayer({ id: 102, name: "Photo 2", kind: 5 });
  let restoredIds = null;
  const doc = { id: 1 };

  await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [l1, l2],
    flipLayerHorizontal: async () => {},
    selectLayersByIds: async ids => {
      restoredIds = ids;
    }
  });

  assert.deepEqual(restoredIds, [101, 102]);
});

test("7. Groups are skipped and not flipped", async () => {
  const group1 = createMockLayer({ id: 201, name: "Group 1", typename: "LayerSet" });
  const group2 = { id: 202, name: "Group 2", kind: 7, layers: [{ id: 999 }] };
  const flippedIds = [];
  const doc = { id: 1 };

  const result = await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [group1, group2],
    flipLayerHorizontal: async l => {
      flippedIds.push(l.id);
    },
    selectLayersByIds: async () => {}
  });

  assert.equal(result.outcome, "no-eligible");
  assert.equal(flippedIds.length, 0);
});

test("8. Text and adjustment layers are skipped", async () => {
  const textLayer = createMockLayer({ id: 301, name: "Heading", kind: 3 });
  const adjLayer = createMockLayer({ id: 302, name: "Curves 1", kind: 2 });
  const bgLayer = createMockLayer({ id: 303, name: "Background", isBackground: true });
  const flippedIds = [];
  const doc = { id: 1 };

  const result = await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [textLayer, adjLayer, bgLayer],
    flipLayerHorizontal: async l => {
      flippedIds.push(l.id);
    },
    selectLayersByIds: async () => {}
  });

  assert.equal(result.outcome, "no-eligible");
  assert.equal(flippedIds.length, 0);
});

test("9. Mixed eligible and ineligible selection: flips eligible, skips unsupported safely", async () => {
  const photo1 = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });
  const textLayer = createMockLayer({ id: 201, name: "Text", kind: "text" });
  const photo2 = createMockLayer({ id: 102, name: "Photo 2", kind: "normal" });
  const group = createMockLayer({ id: 301, name: "Group", typename: "LayerSet" });

  const flippedIds = [];
  const doc = { id: 1 };

  const result = await executeFlipPhotos({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [photo1, textLayer, photo2, group],
    flipLayerHorizontal: async l => {
      flippedIds.push(l.id);
    },
    selectLayersByIds: async () => {}
  });

  assert.equal(result.success, true);
  assert.equal(result.outcome, "mixed");
  assert.equal(result.flippedCount, 2);
  assert.equal(result.skippedCount, 2);
  assert.deepEqual(flippedIds, [101, 102]);

  const toast = buildFlipPhotoToast(result);
  assert.equal(toast.message, "2 flipped • 2 skipped");
  assert.equal(toast.type, "warning");
});

test("10. executeAsModal is used with commandName 'Flip Photos'", async () => {
  const photo = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });
  let modalCalled = false;
  let modalCommand = null;

  await executeFlipPhotos({
    getActiveDocument: () => ({ id: 1 }),
    getSelectedLayers: () => [photo],
    executeModal: async (fn, cmd) => {
      modalCalled = true;
      modalCommand = cmd;
      return fn({});
    },
    flipLayerHorizontal: async () => {},
    selectLayersByIds: async () => {}
  });

  assert.equal(modalCalled, true);
  assert.equal(modalCommand, "Flip Photos");
});

test("11. Failure isolation: if one layer flip fails, remaining layers continue", async () => {
  const l1 = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });
  const l2 = createMockLayer({ id: 102, name: "Locked Photo", kind: 5 });
  const l3 = createMockLayer({ id: 103, name: "Photo 3", kind: 5 });
  const flippedIds = [];

  const result = await executeFlipPhotos({
    getActiveDocument: () => ({ id: 1 }),
    getSelectedLayers: () => [l1, l2, l3],
    flipLayerHorizontal: async l => {
      if (l.id === 102) {
        throw new Error("Layer is locked");
      }
      flippedIds.push(l.id);
    },
    selectLayersByIds: async () => {}
  });

  assert.equal(result.success, true);
  assert.equal(result.outcome, "mixed");
  assert.equal(result.flippedCount, 2);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(flippedIds, [101, 103]);
});

test("12. Smart Objects are never rasterized during flip", async () => {
  const smartObj = createMockLayer({ id: 101, name: "Smart 1", kind: 5 });

  await executeFlipPhotos({
    getActiveDocument: () => ({ id: 1 }),
    getSelectedLayers: () => [smartObj],
    flipLayerHorizontal: async () => {},
    selectLayersByIds: async () => {}
  });

  assert.equal(smartObj.rasterized, false, "Smart Object must not be rasterized");
});

test("13. Success toast count formatting matches exact specification", () => {
  assert.deepEqual(buildFlipPhotoToast({ outcome: "success", flippedCount: 1 }), {
    message: "1 photo flipped",
    type: "success"
  });
  assert.deepEqual(buildFlipPhotoToast({ outcome: "success", flippedCount: 5 }), {
    message: "5 photos flipped",
    type: "success"
  });
});

test("14. Skipped count toast formatting matches exact specification", () => {
  assert.deepEqual(buildFlipPhotoToast({ outcome: "mixed", flippedCount: 3, skippedCount: 2 }), {
    message: "3 flipped • 2 skipped",
    type: "warning"
  });
});

test("15. Button lock and error handling: modal failure returns error outcome", async () => {
  const photo = createMockLayer({ id: 101, name: "Photo 1", kind: 5 });

  const result = await executeFlipPhotos({
    getActiveDocument: () => ({ id: 1 }),
    getSelectedLayers: () => [photo],
    executeModal: async () => {
      throw new Error("Photoshop crash or modal rejected");
    },
    selectLayersByIds: async () => {}
  });

  assert.equal(result.success, false);
  assert.equal(result.outcome, "error");
  const toast = buildFlipPhotoToast(result);
  assert.equal(toast.message, "Photo flip failed");
  assert.equal(toast.type, "error");
});
