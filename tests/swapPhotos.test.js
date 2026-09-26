"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  isSmartObjectLayer,
  isDisallowedLayer,
  sortLayersTopToBottom,
  buildSwapMapping,
  planSwap,
  executeSwapPhotos
} = require("../src/tools/swapPhotos");

function createMockSmartObject({
  id,
  name,
  isBackgroundLayer = false,
  kind = "smartObject",
  isClippingMask = false,
  layers = null
}) {
  const l = {
    id,
    name: name || `SmartObject ${id}`,
    isBackgroundLayer,
    kind,
    isClippingMask,
    layers,
    moveCalls: 0,
    async move() {
      l.moveCalls++;
      throw new Error("photo.move must NOT be called in Swap Photos!");
    }
  };
  return l;
}

function makeSwapHarness({
  selectedLayers,
  allLayers,
  exportFailsOnIndex = null,
  replaceFailsOnIndex = null,
  initialHistoryState = { id: "initial-history-1" }
}) {
  const callSequence = [];
  const cleanupCalls = [];
  let rollbackCalled = false;
  let activeHistory = initialHistoryState;

  const doc = {
    id: 1,
    get activeHistoryState() {
      return activeHistory;
    },
    set activeHistoryState(val) {
      rollbackCalled = true;
      activeHistory = val;
    },
    activeLayers: []
  };

  const dependencies = {
    app: {
      activeDocument: doc,
      documents: [doc]
    },
    getSelectedLayersTopToBottom: () => selectedLayers,
    getAllDocumentLayers: () => allLayers || selectedLayers,
    createTempFiles: async count => {
      const tempFiles = [];
      for (let i = 0; i < count; i++) {
        const tf = {
          name: `mm-swap-test-${i + 1}.psb`,
          delete: async () => {
            cleanupCalls.push(tf.name);
          }
        };
        tempFiles.push(tf);
      }
      return tempFiles;
    },
    exportSmartObjectContents: async (layer, tempFile) => {
      const exportNumber = callSequence.filter(c => c.action === "export").length + 1;
      callSequence.push({ action: "export", layerId: layer.id, tempFile: tempFile.name });
      if (exportFailsOnIndex !== null && exportNumber === exportFailsOnIndex) {
        throw new Error(`Export failed on layer ${layer.id}`);
      }
    },
    replaceSmartObjectContents: async (layer, tempFile) => {
      const replaceNumber = callSequence.filter(c => c.action === "replace").length + 1;
      callSequence.push({ action: "replace", layerId: layer.id, tempFile: tempFile.name });
      if (replaceFailsOnIndex !== null && replaceNumber === replaceFailsOnIndex) {
        throw new Error(`Replace failed on layer ${layer.id}`);
      }
    },
    executeSwapModal: async fn => {
      let suspended = false;
      const executionContext = {
        hostControl: {
          suspendHistory: async () => {
            suspended = true;
            return { id: "suspension-token" };
          },
          resumeHistory: async () => {
            suspended = false;
          }
        }
      };
      return fn(executionContext);
    }
  };

  return {
    dependencies,
    callSequence,
    cleanupCalls,
    doc,
    isRollbackCalled: () => rollbackCalled
  };
}

// ==================================================
// TESTS: PURE SWAP MAPPING
// ==================================================

test("1. 2 selected Smart Object IDs: [A, B] -> replacement mapping: A <- B, B <- A", () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });

  const mapping = buildSwapMapping([photoA, photoB]);
  assert.equal(mapping.length, 2);

  // Layer 1 (Photo A) receives Content from Layer 2 (Photo B, temp file 2)
  assert.equal(mapping[0].targetLayer.id, photoA.id);
  assert.equal(mapping[0].sourceLayer.id, photoB.id);
  assert.equal(mapping[0].sourceIndex, 2);

  // Layer 2 (Photo B) receives Content from Layer 1 (Photo A, temp file 1)
  assert.equal(mapping[1].targetLayer.id, photoB.id);
  assert.equal(mapping[1].sourceLayer.id, photoA.id);
  assert.equal(mapping[1].sourceIndex, 1);
});

test("2. 3 selected Smart Object IDs: [A, B, C] -> replacement mapping: A <- C, B <- A, C <- B", () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });
  const photoC = createMockSmartObject({ id: 103, name: "Photo C" });

  const mapping = buildSwapMapping([photoA, photoB, photoC]);
  assert.equal(mapping.length, 3);

  // Layer 1 (Photo A) gets Content C (Layer 3, temp 3)
  assert.equal(mapping[0].targetLayer.id, photoA.id);
  assert.equal(mapping[0].sourceLayer.id, photoC.id);
  assert.equal(mapping[0].sourceIndex, 3);

  // Layer 2 (Photo B) gets Content A (Layer 1, temp 1)
  assert.equal(mapping[1].targetLayer.id, photoB.id);
  assert.equal(mapping[1].sourceLayer.id, photoA.id);
  assert.equal(mapping[1].sourceIndex, 1);

  // Layer 3 (Photo C) gets Content B (Layer 2, temp 2)
  assert.equal(mapping[2].targetLayer.id, photoC.id);
  assert.equal(mapping[2].sourceLayer.id, photoB.id);
  assert.equal(mapping[2].sourceIndex, 2);
});

test("3. deterministic top-to-bottom ordering", () => {
  const photoA = createMockSmartObject({ id: 101, name: "Top Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Middle Photo B" });
  const photoC = createMockSmartObject({ id: 103, name: "Bottom Photo C" });

  const allDocumentLayers = [photoA, photoB, photoC];

  // Pass in reverse/scrambled selection order: [C, A, B]
  const plan = planSwap([photoC, photoA, photoB], allDocumentLayers);
  assert.equal(plan.success, true);
  assert.equal(plan.orderedLayers[0].id, photoA.id);
  assert.equal(plan.orderedLayers[1].id, photoB.id);
  assert.equal(plan.orderedLayers[2].id, photoC.id);

  // Check mapping corresponds to the sorted top-to-bottom order:
  // L1 (A) <- C, L2 (B) <- A, L3 (C) <- B
  assert.equal(plan.mapping[0].targetLayer.id, photoA.id);
  assert.equal(plan.mapping[0].sourceLayer.id, photoC.id);
  assert.equal(plan.mapping[1].targetLayer.id, photoB.id);
  assert.equal(plan.mapping[1].sourceLayer.id, photoA.id);
  assert.equal(plan.mapping[2].targetLayer.id, photoC.id);
  assert.equal(plan.mapping[2].sourceLayer.id, photoB.id);
});

test("4. selection count 0 rejected", async () => {
  const harness = makeSwapHarness({ selectedLayers: [], allLayers: [] });
  const result = await executeSwapPhotos(harness.dependencies);

  assert.equal(result.success, false);
  assert.equal(result.outcome, "invalid-selection");
  assert.equal(result.message, "Select 2 or 3 Smart Object photos");
  assert.equal(harness.callSequence.length, 0);
});

test("5. selection count 1 rejected", async () => {
  const photoA = createMockSmartObject({ id: 101 });
  const harness = makeSwapHarness({ selectedLayers: [photoA], allLayers: [photoA] });
  const result = await executeSwapPhotos(harness.dependencies);

  assert.equal(result.success, false);
  assert.equal(result.outcome, "invalid-selection");
  assert.equal(result.message, "Select 2 or 3 Smart Object photos");
  assert.equal(harness.callSequence.length, 0);
});

test("6. selection count 4 rejected", async () => {
  const p1 = createMockSmartObject({ id: 1 });
  const p2 = createMockSmartObject({ id: 2 });
  const p3 = createMockSmartObject({ id: 3 });
  const p4 = createMockSmartObject({ id: 4 });
  const harness = makeSwapHarness({ selectedLayers: [p1, p2, p3, p4], allLayers: [p1, p2, p3, p4] });
  const result = await executeSwapPhotos(harness.dependencies);

  assert.equal(result.success, false);
  assert.equal(result.outcome, "invalid-selection");
  assert.equal(result.message, "Select 2 or 3 Smart Object photos");
  assert.equal(harness.callSequence.length, 0);
});

test("7. non-Smart Object selection rejected", () => {
  const textLayer = { id: 201, kind: "text" };
  const pixelLayer = { id: 202, kind: "normal" };
  const adjLayer = { id: 203, kind: "adjustment" };
  const shapeLayer = { id: 204, kind: "solidColor" };
  const groupLayer = { id: 205, layers: [{ id: 206 }] };
  const bgLayer = { id: 207, isBackgroundLayer: true, kind: "background" };

  assert.equal(isSmartObjectLayer(textLayer), false);
  assert.equal(isSmartObjectLayer(pixelLayer), false);
  assert.equal(isSmartObjectLayer(adjLayer), false);
  assert.equal(isSmartObjectLayer(shapeLayer), false);
  assert.equal(isSmartObjectLayer(groupLayer), false);
  assert.equal(isSmartObjectLayer(bgLayer), false);

  assert.equal(isDisallowedLayer(textLayer), true);
  assert.equal(isDisallowedLayer(pixelLayer), true);
  assert.equal(isDisallowedLayer(adjLayer), true);
});

test("8. mixed Smart Object + invalid layer rejected before export", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const textLayer = { id: 999, name: "Title Text", kind: "text" };

  const harness = makeSwapHarness({
    selectedLayers: [photoA, textLayer],
    allLayers: [photoA, textLayer]
  });

  const result = await executeSwapPhotos(harness.dependencies);
  assert.equal(result.success, false);
  assert.equal(result.outcome, "invalid-selection");
  assert.equal(result.message, "Select 2 or 3 Smart Object photos");
  assert.equal(harness.callSequence.length, 0); // No exports or replacements called
});

// ==================================================
// TESTS: EXPORT BEFORE REPLACE
// ==================================================

test("9. 2-photo call sequence: export A, export B, replace A with B, replace B with A", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB],
    allLayers: [photoA, photoB]
  });

  const result = await executeSwapPhotos(harness.dependencies);
  assert.equal(result.success, true);
  assert.equal(result.count, 2);
  assert.equal(result.message, "2 photos swapped");

  // Call sequence verification
  const seq = harness.callSequence;
  assert.equal(seq.length, 4);

  // Phase 1: Exports
  assert.deepEqual(seq[0], { action: "export", layerId: photoA.id, tempFile: "mm-swap-test-1.psb" });
  assert.deepEqual(seq[1], { action: "export", layerId: photoB.id, tempFile: "mm-swap-test-2.psb" });

  // Phase 2: Replacements (using the exported files)
  assert.deepEqual(seq[2], { action: "replace", layerId: photoA.id, tempFile: "mm-swap-test-2.psb" });
  assert.deepEqual(seq[3], { action: "replace", layerId: photoB.id, tempFile: "mm-swap-test-1.psb" });

  // Cleanup: all temp files cleaned up
  assert.deepEqual(harness.cleanupCalls, ["mm-swap-test-1.psb", "mm-swap-test-2.psb"]);
});

test("10. 3-photo call sequence: export A, B, C then replace A(C), B(A), C(B)", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });
  const photoC = createMockSmartObject({ id: 103, name: "Photo C" });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB, photoC],
    allLayers: [photoA, photoB, photoC]
  });

  const result = await executeSwapPhotos(harness.dependencies);
  assert.equal(result.success, true);
  assert.equal(result.count, 3);
  assert.equal(result.message, "3 photos swapped");

  const seq = harness.callSequence;
  assert.equal(seq.length, 6);

  // All 3 exports happen first
  assert.deepEqual(seq[0], { action: "export", layerId: photoA.id, tempFile: "mm-swap-test-1.psb" });
  assert.deepEqual(seq[1], { action: "export", layerId: photoB.id, tempFile: "mm-swap-test-2.psb" });
  assert.deepEqual(seq[2], { action: "export", layerId: photoC.id, tempFile: "mm-swap-test-3.psb" });

  // Then all 3 replacements
  assert.deepEqual(seq[3], { action: "replace", layerId: photoA.id, tempFile: "mm-swap-test-3.psb" });
  assert.deepEqual(seq[4], { action: "replace", layerId: photoB.id, tempFile: "mm-swap-test-1.psb" });
  assert.deepEqual(seq[5], { action: "replace", layerId: photoC.id, tempFile: "mm-swap-test-2.psb" });

  // Cleanup
  assert.deepEqual(harness.cleanupCalls, ["mm-swap-test-1.psb", "mm-swap-test-2.psb", "mm-swap-test-3.psb"]);
});

test("11. assert NO replace happens before ALL exports succeed", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });
  const photoC = createMockSmartObject({ id: 103, name: "Photo C" });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB, photoC],
    allLayers: [photoA, photoB, photoC]
  });

  await executeSwapPhotos(harness.dependencies);

  const firstReplaceIdx = harness.callSequence.findIndex(c => c.action === "replace");
  const lastExportIdx = harness.callSequence.findLastIndex(c => c.action === "export");

  assert.ok(firstReplaceIdx > lastExportIdx, "First replacement must occur after the last export");
});

// ==================================================
// TESTS: EXPORT FAILURE
// ==================================================

test("12. if export 2 fails: zero replace calls, result = failure, cleanup attempted", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB],
    allLayers: [photoA, photoB],
    exportFailsOnIndex: 2
  });

  const result = await executeSwapPhotos(harness.dependencies);
  assert.equal(result.success, false);
  assert.equal(result.outcome, "error");
  assert.equal(result.stage, "export-2");
  assert.equal(result.message, "Swap failed");

  // Assert ZERO replace calls were made
  const replaceCalls = harness.callSequence.filter(c => c.action === "replace");
  assert.equal(replaceCalls.length, 0);

  // Assert cleanup was executed
  assert.equal(harness.cleanupCalls.length, 2);
});

test("13. if export 3 fails in 3-photo swap: zero replacements", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });
  const photoC = createMockSmartObject({ id: 103, name: "Photo C" });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB, photoC],
    allLayers: [photoA, photoB, photoC],
    exportFailsOnIndex: 3
  });

  const result = await executeSwapPhotos(harness.dependencies);
  assert.equal(result.success, false);
  assert.equal(result.outcome, "error");
  assert.equal(result.stage, "export-3");

  const replaceCalls = harness.callSequence.filter(c => c.action === "replace");
  assert.equal(replaceCalls.length, 0);
  assert.equal(harness.cleanupCalls.length, 3);
});

// ==================================================
// TESTS: REPLACEMENT FAILURE & ROLLBACK
// ==================================================

test("14. if one replacement fails: rollback is attempted, later replacements halted, cleanup attempted", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Photo A" });
  const photoB = createMockSmartObject({ id: 102, name: "Photo B" });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB],
    allLayers: [photoA, photoB],
    replaceFailsOnIndex: 2 // Replace 1 succeeds, replace 2 fails
  });

  const result = await executeSwapPhotos(harness.dependencies);
  assert.equal(result.success, false);
  assert.equal(result.outcome, "error");
  assert.equal(result.stage, "replace-2");
  assert.equal(result.message, "Swap failed");

  // Rollback should have been triggered
  assert.equal(harness.isRollbackCalled(), true);

  // Cleanup of temp files was attempted
  assert.equal(harness.cleanupCalls.length, 2);
});

// ==================================================
// TESTS: NO OLD MOVE LOGIC
// ==================================================

test("15. static check: swapPhotos.js does not contain photo.move, ElementPlacement, or fitCover", () => {
  const srcPath = path.resolve(__dirname, "../src/tools/swapPhotos.js");
  const code = fs.readFileSync(srcPath, "utf8");

  assert.equal(/\.move\s*\(/i.test(code), false, "swapPhotos.js must not call .move()");
  assert.equal(/ElementPlacement/i.test(code), false, "swapPhotos.js must not reference ElementPlacement");
  assert.equal(/fitCover/i.test(code), false, "swapPhotos.js must not call fitCover");
});

test("16. dynamic check: photo.move is never called on layer objects during swap", async () => {
  const photoA = createMockSmartObject({ id: 101 });
  const photoB = createMockSmartObject({ id: 102 });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB],
    allLayers: [photoA, photoB]
  });

  await executeSwapPhotos(harness.dependencies);
  assert.equal(photoA.moveCalls, 0);
  assert.equal(photoB.moveCalls, 0);
});

// ==================================================
// TESTS: NO PLACEHOLDER REQUIREMENT
// ==================================================

test("17. swap proceeds without placeholder layers or placeholder resolution", async () => {
  const photoA = createMockSmartObject({ id: 101, name: "Smart A" });
  const photoB = createMockSmartObject({ id: 102, name: "Smart B" });

  // Notice no placeholder objects in the document at all
  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB],
    allLayers: [photoA, photoB]
  });

  const result = await executeSwapPhotos(harness.dependencies);
  assert.equal(result.success, true);
  assert.equal(result.count, 2);
  assert.equal(result.message, "2 photos swapped");
});

// ==================================================
// TESTS: FILESYSTEM ISOLATION
// ==================================================

test("18. Swap Photos does not call Album Used, source picker, or moveUsedFiles", async () => {
  let fsCalled = false;
  const mockFs = {
    selectImageFiles: async () => { fsCalled = true; return []; },
    moveUsedFiles: async () => { fsCalled = true; return {}; }
  };

  const photoA = createMockSmartObject({ id: 101 });
  const photoB = createMockSmartObject({ id: 102 });

  const harness = makeSwapHarness({
    selectedLayers: [photoA, photoB],
    allLayers: [photoA, photoB]
  });

  await executeSwapPhotos({
    ...harness.dependencies,
    ...mockFs
  });

  assert.equal(fsCalled, false);
});

// ==================================================
// TESTS: TOAST & USER REPORTING
// ==================================================

test("19. toast messages match specification: 2 photos swapped, 3 photos swapped, invalid selection, Swap failed", async () => {
  // Case 1: 2 photos
  const pA = createMockSmartObject({ id: 101 });
  const pB = createMockSmartObject({ id: 102 });
  const h2 = makeSwapHarness({ selectedLayers: [pA, pB], allLayers: [pA, pB] });
  const r2 = await executeSwapPhotos(h2.dependencies);
  assert.equal(r2.message, "2 photos swapped");

  // Case 2: 3 photos
  const pC = createMockSmartObject({ id: 103 });
  const h3 = makeSwapHarness({ selectedLayers: [pA, pB, pC], allLayers: [pA, pB, pC] });
  const r3 = await executeSwapPhotos(h3.dependencies);
  assert.equal(r3.message, "3 photos swapped");

  // Case 3: Invalid selection count (1 photo)
  const h1 = makeSwapHarness({ selectedLayers: [pA], allLayers: [pA] });
  const r1 = await executeSwapPhotos(h1.dependencies);
  assert.equal(r1.message, "Select 2 or 3 Smart Object photos");

  // Case 4: Invalid layer kind (text layer)
  const textLayer = { id: 555, kind: "text" };
  const hInvalid = makeSwapHarness({ selectedLayers: [pA, textLayer], allLayers: [pA, textLayer] });
  const rInvalid = await executeSwapPhotos(hInvalid.dependencies);
  assert.equal(rInvalid.message, "Select 2 or 3 Smart Object photos");

  // Case 5: Runtime failure
  const hFail = makeSwapHarness({ selectedLayers: [pA, pB], allLayers: [pA, pB], exportFailsOnIndex: 1 });
  const rFail = await executeSwapPhotos(hFail.dependencies);
  assert.equal(rFail.message, "Swap failed");
});
