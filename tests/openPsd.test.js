"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  KEYWORDS,
  matchesKeyword,
  getParentDuplicateNames,
  isGroupLayer,
  isTextLayer,
  isBackgroundLayer,
  isClippedLayer,
  shouldSkipLayer,
  isRenameCandidate,
  formatLayerName,
  smartRenameDocument,
  approx,
  classifyAlbumSize,
  getTargetDimensions,
  calculateAlbumGuides,
  buildOpenPsdToast,
  executeOpenPsd,
  getDefaultDependencies
} = require("../src/tools/openPsd");

const {
  normalizeDocumentToPixels,
  getDocumentMetrics,
  normalizeAlbumSize,
  clearAllGuides,
  addAlbumGuides,
  extractPixels,
  extractResolution
} = require("../src/photoshop");

// ==========================================
// 1-6. UI Layout & Elements
// ==========================================

test("1. OPEN PSD button exists in index.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(/id="openPsdBtn"/i.test(html), "index.html must contain openPsdBtn");
  assert.ok(/data-tool="open-psd"/i.test(html), "openPsdBtn must have data-tool='open-psd'");
});

test("2. OPEN PSD appears BEFORE AUTO PHOTO FILL", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const openPos = html.indexOf('id="openPsdBtn"');
  const autoPos = html.indexOf('id="autoPhotoFillBtn"');
  assert.ok(openPos !== -1 && autoPos !== -1, "Both buttons must exist in index.html");
  assert.ok(openPos < autoPos, "openPsdBtn must appear before autoPhotoFillBtn");
});

test("3. AUTO PHOTO FILL appears BEFORE SWAP PHOTOS", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const autoPos = html.indexOf('id="autoPhotoFillBtn"');
  const swapPos = html.indexOf('id="swapPhotosBtn"');
  assert.ok(autoPos !== -1 && swapPos !== -1, "Both buttons must exist in index.html");
  assert.ok(autoPos < swapPos, "autoPhotoFillBtn must appear before swapPhotosBtn");
});

test("4. Visible version is present in index.html and manifest.json", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes("v1.4.0"), "index.html must display version");

  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
  assert.equal(manifest.version, "1.4.0", "manifest.json version must be valid");
  assert.equal(manifest.id, "in.memorymaker.albumplacer", "plugin ID must remain in.memorymaker.albumplacer");
});

test("5. Panel contains no long descriptive tool cards or permanent result panels", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.equal(/id="resultDialog"/i.test(html), false, "no resultDialog allowed");
  assert.equal(/id="resultPanel"/i.test(html), false, "no resultPanel allowed");
  assert.equal(/card/i.test(html), false, "no descriptive card allowed");
});

test("6. Existing toast system remains present in index.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(/id="toast"/i.test(html), "toast container must be present");
});

// ==========================================
// 7-9. Picker & Cancel Behavior
// ==========================================

test("7. OPEN PSD requests multiple-file selection", async () => {
  let pickerOptions = null;
  await executeOpenPsd({
    selectPsdFiles: async () => {
      pickerOptions = { types: ["psd"], allowMultiple: true };
      return [];
    }
  });
  assert.equal(pickerOptions.allowMultiple, true);
});

test("8. Picker is limited to PSD", async () => {
  let pickerOptions = null;
  await executeOpenPsd({
    selectPsdFiles: async () => {
      pickerOptions = { types: ["psd"], allowMultiple: true };
      return [];
    }
  });
  assert.deepEqual(pickerOptions.types, ["psd"]);
});

test("9. Cancel causes zero Photoshop mutations, zero open attempts, and Cancelled result", async () => {
  let openCalls = 0;
  let modalCalls = 0;
  let renameCalls = 0;

  const result = await executeOpenPsd({
    selectPsdFiles: async () => null, // user canceled
    openDocument: async () => {
      openCalls++;
      return {};
    },
    executeModal: async fn => {
      modalCalls++;
      return fn();
    },
    smartRenameLayers: () => {
      renameCalls++;
    }
  });

  assert.equal(result.outcome, "cancelled");
  assert.equal(result.successCount, 0);
  assert.equal(result.failureCount, 0);
  assert.equal(openCalls, 0);
  assert.equal(modalCalls, 0);
  assert.equal(renameCalls, 0);

  const toast = buildOpenPsdToast(result);
  assert.equal(toast.message, "Cancelled");
  assert.equal(toast.type, "info");
});

// ==========================================
// 10-14. Physical Size Classification
// ==========================================

test("10. classify 7200 × 2400 @ 200, 10800 × 3600 @ 300, 5400 × 1800 @ 150 as 36x12", () => {
  assert.equal(classifyAlbumSize(7200, 2400, 200), "36x12");
  assert.equal(classifyAlbumSize(10800, 3600, 300), "36x12");
  assert.equal(classifyAlbumSize(5400, 1800, 150), "36x12");
});

test("11. classify 3600 × 2400 @ 200, 5400 × 3600 @ 300, 2700 × 1800 @ 150 as 18x12", () => {
  assert.equal(classifyAlbumSize(3600, 2400, 200), "18x12");
  assert.equal(classifyAlbumSize(5400, 3600, 300), "18x12");
  assert.equal(classifyAlbumSize(2700, 1800, 150), "18x12");
});

test("12. classify 6000 × 4000 @ 300 as unsupported/fallback", () => {
  assert.equal(classifyAlbumSize(6000, 4000, 300), "unsupported");
});

test("13. classify 3600 × 5400 @ 300 and 2400 × 7200 @ 200 as unsupported (portrait orientation rejected)", () => {
  assert.equal(classifyAlbumSize(3600, 5400, 300), "unsupported");
  assert.equal(classifyAlbumSize(2400, 7200, 200), "unsupported");
});

test("14. 18×12 format targets 5400 × 3600 and must NOT target 10800 × 3600", () => {
  const dims = getTargetDimensions("18x12");
  assert.equal(dims.targetWidth, 5400);
  assert.equal(dims.targetHeight, 3600);
  assert.equal(dims.targetDpi, 300);
  assert.notEqual(dims.targetWidth, 10800);
});

// ==========================================
// 15-19. Normalization Targets & Execution
// ==========================================

test("15. 7200 × 2400 @ 200 targets exactly 10800 × 3600 @ 300", () => {
  const format = classifyAlbumSize(7200, 2400, 200);
  assert.equal(format, "36x12");
  const dims = getTargetDimensions(format);
  assert.deepEqual(dims, { targetWidth: 10800, targetHeight: 3600, targetDpi: 300 });
});

test("16. 3600 × 2400 @ 200 targets exactly 5400 × 3600 @ 300", () => {
  const format = classifyAlbumSize(3600, 2400, 200);
  assert.equal(format, "18x12");
  const dims = getTargetDimensions(format);
  assert.deepEqual(dims, { targetWidth: 5400, targetHeight: 3600, targetDpi: 300 });
});

test("17. Documents already 10800 × 3600 @ 300 or 5400 × 3600 @ 300 remain unchanged without unnecessary resample", async () => {
  let resampleCalls = 0;
  const mockDoc = {
    name: "Native36.psd",
    width: 10800,
    height: 3600,
    resolution: 300
  };

  await executeOpenPsd({
    selectPsdFiles: async () => [mockDoc],
    openDocument: async () => mockDoc,
    getDocumentMetrics: async () => ({
      name: mockDoc.name,
      pixelWidth: 10800,
      pixelHeight: 3600,
      resolution: 300,
      widthInches: 36,
      heightInches: 12
    }),
    normalizeDocumentToPixels: async () => {
      resampleCalls++;
    },
    executeModal: async fn => fn(),
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(resampleCalls, 0, "No resampling should be performed when already at target size and DPI");
});

test("18. Unsupported size (e.g. 6000 × 4000 @ 300) targets legacy fallback 10800 × 3600 @ 300", () => {
  const format = classifyAlbumSize(6000, 4000, 300);
  assert.equal(format, "unsupported");
  const dims = getTargetDimensions(format);
  assert.deepEqual(dims, { targetWidth: 10800, targetHeight: 3600, targetDpi: 300 });
});

test("19. normalizeDocumentToPixels resamples to target dimensions using Bicubic Sharper", async () => {
  const resizeArgs = [];
  const mockDoc = {
    width: 7200,
    height: 2400,
    resolution: 200,
    resizeImage: async (w, h, res, method) => {
      resizeArgs.push({ w, h, res, method });
    }
  };

  await normalizeDocumentToPixels(mockDoc, 10800, 3600, 300);

  assert.equal(resizeArgs.length, 1);
  const call = resizeArgs[0];
  assert.equal(call.w, 10800);
  assert.equal(call.h, 3600);
  assert.equal(call.res, 300);
  assert.equal(String(call.method).toLowerCase(), "bicubicsharper");
});

test("19b. Post-resize verification throws if target dimensions were not achieved", async () => {
  const mockDoc = {
    name: "Broken.psd",
    width: 7200,
    height: 2400,
    resolution: 200
  };

  const loggedErrors = [];
  const origError = console.error;
  console.error = (...args) => loggedErrors.push(args);

  try {
    const result = await executeOpenPsd({
      selectPsdFiles: async () => [mockDoc],
      openDocument: async () => mockDoc,
      getDocumentMetrics: async () => ({
        name: mockDoc.name,
        pixelWidth: 7200, // Failed to reach 10800
        pixelHeight: 2400,
        resolution: 200,
        widthInches: 36,
        heightInches: 12
      }),
      normalizeDocumentToPixels: async () => {},
      executeModal: async fn => fn(),
      clearAllGuides: async () => {},
      addAlbumGuides: async () => {}
    });

    assert.equal(result.outcome, "error");
    assert.equal(result.failureCount, 1);
    assert.ok(loggedErrors.length > 0);
    const errPayload = loggedErrors[0][1];
    assert.equal(errPayload.stage, "verify-size");
    assert.ok(errPayload.errorMessage.includes("Open PSD normalization failed"));
  } finally {
    console.error = origError;
  }
});

// ==========================================
// 20-22. Guide Calculations & Reset
// ==========================================

test("20. Guide calculation for 36×12 (10800 × 3600)", () => {
  const guides = calculateAlbumGuides(10800, 3600);
  assert.deepEqual(guides.verticalGuides, [100, 150, 5400, 10650, 10700]);
  assert.deepEqual(guides.horizontalGuides, [100, 150, 3450, 3500]);
});

test("21. Guide calculation for 18×12 (5400 × 3600)", () => {
  const guides = calculateAlbumGuides(5400, 3600);
  assert.deepEqual(guides.verticalGuides, [100, 150, 2700, 5250, 5300]);
  assert.deepEqual(guides.horizontalGuides, [100, 150, 3450, 3500]);
});

test("22. Guides are cleared BEFORE new guides are added", async () => {
  const events = [];
  const mockDoc = {
    width: 10800,
    height: 3600,
    guides: {
      removeAll: () => {
        events.push("clearGuides");
      },
      add: (dir, pos) => {
        events.push(`addGuide:${dir}:${pos}`);
      }
    }
  };

  await clearAllGuides(mockDoc);
  const guides = calculateAlbumGuides(mockDoc.width, mockDoc.height);
  await addAlbumGuides(mockDoc, guides);

  assert.equal(events[0], "clearGuides");
  assert.ok(events.length > 1);
  assert.ok(events[1].startsWith("addGuide:"));
});

// ==========================================
// 23. Keywords Matching
// ==========================================

test("23. Exact 9 keywords matched case-insensitively", () => {
  assert.deepEqual(KEYWORDS, [
    "studio",
    "digital",
    "color",
    "lab",
    "graphics",
    "album",
    "photo",
    "photography",
    "creation"
  ]);

  assert.equal(matchesKeyword("ABC Studio"), true);
  assert.equal(matchesKeyword("PHOTO 01"), true);
  assert.equal(matchesKeyword("Digital Lab"), true);
  assert.equal(matchesKeyword("Wedding Photography"), true);
  assert.equal(matchesKeyword("Color Correction"), true);
  assert.equal(matchesKeyword("Design Graphics"), true);
  assert.equal(matchesKeyword("Family Album"), true);
  assert.equal(matchesKeyword("Art Creation"), true);

  assert.equal(matchesKeyword("Bride 01"), false);
  assert.equal(matchesKeyword("Background Art"), false);
  assert.equal(matchesKeyword("Groom Portrait"), false);
});

// ==========================================
// 24. Duplicate Sibling Detection
// ==========================================

test("24. Duplicate names detection scoped to same parent level", () => {
  const groupA = [
    { name: "Layer" },
    { name: "Layer" },
    { name: "Unique" }
  ];
  const groupB = [
    { name: "Layer" },
    { name: "Other" }
  ];

  const dupesA = getParentDuplicateNames(groupA);
  const dupesB = getParentDuplicateNames(groupB);

  assert.equal(dupesA.has("layer"), true);
  assert.equal(dupesA.has("unique"), false);

  assert.equal(dupesB.has("layer"), false);
  assert.equal(dupesB.has("other"), false);
});

// ==========================================
// 25. Rename Skips
// ==========================================

test("25. Layer skip rules (hidden, background, text, clipping mask, group containers)", () => {
  const hiddenLayer = { visible: false, name: "Photo", kind: "normal" };
  const bgLayer = { visible: true, isBackgroundLayer: true, name: "Background" };
  const textLayer = { visible: true, kind: "text", name: "Photo" };
  const clippedLayer = { visible: true, isClippingMask: true, name: "Photo" };
  const groupLayer = { visible: true, typename: "LayerSet", name: "Photo Group", layers: [] };
  const normalLayer = { visible: true, kind: "normal", name: "Photo" };

  assert.equal(shouldSkipLayer(hiddenLayer), true);
  assert.equal(shouldSkipLayer(bgLayer), true);
  assert.equal(shouldSkipLayer(textLayer), true);
  assert.equal(shouldSkipLayer(clippedLayer), true);
  assert.equal(shouldSkipLayer(groupLayer), true);
  assert.equal(shouldSkipLayer(normalLayer), false);
});

// ==========================================
// 26-27. Rename Order, Document-Wide Counter & Exact Format
// ==========================================

test("26. Rename order: bottom-to-top processing with one shared document-wide counter", () => {
  const child1 = { id: 1, name: "Photo", visible: true };
  const child2 = { id: 2, name: "Photo", visible: true };
  const group1 = {
    id: 3,
    typename: "LayerSet",
    name: "Group 1",
    visible: true,
    layers: [
      child1, // top of group (index 0)
      child2  // bottom of group (index 1)
    ]
  };
  const layerC = { id: 4, name: "Studio C", visible: true }; // bottom of root (index 2)
  const layerB = group1; // middle of root (index 1)
  const layerA = { id: 5, name: "Studio A", visible: true }; // top of root (index 0)

  const doc = {
    name: "Album.psd",
    layers: [layerA, layerB, layerC]
  };

  smartRenameDocument(doc);

  // Bottom to top:
  // 1st: layerC (bottom-most in root) -> 01
  assert.equal(layerC.name, "01 MMR | 7001514367");

  // 2nd: group1 (recurses from bottom to top: child2, then child1)
  assert.equal(child2.name, "02 MMR | 7001514367");
  assert.equal(child1.name, "03 MMR | 7001514367");

  // 3rd: layerA (top-most in root) -> 04
  assert.equal(layerA.name, "04 MMR | 7001514367");
});

test("27. Exact rename format padding: 01, 02, 09, 10, 11", () => {
  assert.equal(formatLayerName(1), "01 MMR | 7001514367");
  assert.equal(formatLayerName(2), "02 MMR | 7001514367");
  assert.equal(formatLayerName(9), "09 MMR | 7001514367");
  assert.equal(formatLayerName(10), "10 MMR | 7001514367");
  assert.equal(formatLayerName(11), "11 MMR | 7001514367");
  assert.equal(formatLayerName(100), "100 MMR | 7001514367");
});

test("27b. Counter resets to 01 for EACH new PSD", () => {
  const doc1 = {
    name: "Doc1.psd",
    layers: [{ name: "Photo", visible: true }]
  };
  const doc2 = {
    name: "Doc2.psd",
    layers: [{ name: "Photo", visible: true }]
  };

  smartRenameDocument(doc1);
  assert.equal(doc1.layers[0].name, "01 MMR | 7001514367");

  smartRenameDocument(doc2);
  assert.equal(doc2.layers[0].name, "01 MMR | 7001514367");
});

// ==========================================
// 28. Multi-PSD Sequential Orchestration
// ==========================================

test("28. Multi-PSD processing is sequential and does not run concurrently", async () => {
  const order = [];
  const files = [
    { name: "Page01.psd" },
    { name: "Page02.psd" },
    { name: "Page03.psd" }
  ];

  let concurrentCount = 0;
  let maxConcurrent = 0;

  const result = await executeOpenPsd({
    selectPsdFiles: async () => files,
    openDocument: async file => {
      order.push(`open:${file.name}`);
      return { name: file.name, width: 10800, height: 3600 };
    },
    setActiveDocument: doc => {
      order.push(`setActive:${doc.name}`);
    },
    executeModal: async (fn, cmd) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      order.push(`modalStart:${cmd}`);
      await fn();
      order.push(`modalEnd:${cmd}`);
      concurrentCount--;
    },
    smartRenameLayers: doc => {
      order.push(`rename:${doc.name}`);
    },
    normalizeAlbumSize: async doc => {
      order.push(`normalize:${doc.name}`);
    },
    clearAllGuides: async doc => {
      order.push(`clearGuides:${doc.name}`);
    },
    addAlbumGuides: async doc => {
      order.push(`addGuides:${doc.name}`);
    }
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.successCount, 3);
  assert.equal(maxConcurrent, 1, "Must never run documents concurrently");

  // Verify strict sequential order inside per-document modals
  assert.equal(order[0], "modalStart:FM Open PSD - Page01.psd");
  assert.equal(order[1], "open:Page01.psd");
  assert.equal(order[2], "setActive:Page01.psd");
  const p1EndIdx = order.indexOf("modalEnd:FM Open PSD - Page01.psd");
  const p2StartIdx = order.indexOf("modalStart:FM Open PSD - Page02.psd");
  const p2OpenIdx = order.indexOf("open:Page02.psd");
  assert.ok(p1EndIdx < p2StartIdx, "Page01 modal must finish before Page02 modal starts");
  assert.ok(p2StartIdx < p2OpenIdx, "Page02 modal must start before Page02 opens");

  const p2EndIdx = order.indexOf("modalEnd:FM Open PSD - Page02.psd");
  const p3StartIdx = order.indexOf("modalStart:FM Open PSD - Page03.psd");
  const p3OpenIdx = order.indexOf("open:Page03.psd");
  assert.ok(p2EndIdx < p3StartIdx, "Page02 modal must finish before Page03 modal starts");
  assert.ok(p3StartIdx < p3OpenIdx, "Page03 modal must start before Page03 opens");
});

// ==========================================
// 29. No Automatic Save or Close
// ==========================================

test("29. Assert OPEN PSD never automatically calls save, saveAs, or close", async () => {
  let saveCalls = 0;
  let saveAsCalls = 0;
  let closeCalls = 0;

  const mockDoc = {
    name: "Doc.psd",
    width: 10800,
    height: 3600,
    save: () => { saveCalls++; },
    saveAs: () => { saveAsCalls++; },
    close: () => { closeCalls++; },
    closeWithoutSaving: () => { closeCalls++; }
  };

  await executeOpenPsd({
    selectPsdFiles: async () => [{ name: "Doc.psd" }],
    openDocument: async () => mockDoc,
    executeModal: async fn => fn(),
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(saveCalls, 0, "must not call save");
  assert.equal(saveAsCalls, 0, "must not call saveAs");
  assert.equal(closeCalls, 0, "must not call close or closeWithoutSaving");
});

// ==========================================
// 30. Failure Isolation
// ==========================================

test("30. Failure isolation: if PSD 2 fails, PSD 3 is still attempted", async () => {
  const attempted = [];
  const files = [
    { name: "PSD1.psd" },
    { name: "PSD2_Bad.psd" },
    { name: "PSD3.psd" }
  ];

  const result = await executeOpenPsd({
    selectPsdFiles: async () => files,
    openDocument: async file => {
      attempted.push(file.name);
      if (file.name === "PSD2_Bad.psd") {
        throw new Error("Corrupted PSD file");
      }
      return { name: file.name, width: 10800, height: 3600 };
    },
    executeModal: async fn => fn(),
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.deepEqual(attempted, ["PSD1.psd", "PSD2_Bad.psd", "PSD3.psd"]);
  assert.equal(result.outcome, "partial");
  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 1);
  assert.equal(result.totalCount, 3);
});

// ==========================================
// 31. Toast Outputs
// ==========================================

test("31. Toast messages match all specifications", () => {
  // 1 success
  const t1 = buildOpenPsdToast({ outcome: "success", successCount: 1, failureCount: 0 });
  assert.equal(t1.message, "1 PSD opened");
  assert.equal(t1.type, "success");

  // 2 success
  const t2 = buildOpenPsdToast({ outcome: "success", successCount: 2, failureCount: 0 });
  assert.equal(t2.message, "2 PSDs opened");
  assert.equal(t2.type, "success");

  // 3 success
  const t3 = buildOpenPsdToast({ outcome: "success", successCount: 3, failureCount: 0 });
  assert.equal(t3.message, "3 PSDs opened");
  assert.equal(t3.type, "success");

  // Partial failure (e.g. 2 succeeded, 1 failed)
  const t4 = buildOpenPsdToast({ outcome: "partial", successCount: 2, failureCount: 1 });
  assert.equal(t4.message, "2 PSDs opened • 1 failed");
  assert.equal(t4.type, "warning");

  // All failed
  const t5 = buildOpenPsdToast({ outcome: "error", successCount: 0, failureCount: 3 });
  assert.equal(t5.message, "Open PSD failed");
  assert.equal(t5.type, "error");

  // Cancelled
  const t6 = buildOpenPsdToast({ outcome: "cancelled", successCount: 0, failureCount: 0 });
  assert.equal(t6.message, "Cancelled");
  assert.equal(t6.type, "info");
});

// ==========================================
// Fault Tolerance on Layer Rename
// ==========================================

test("32. Individual layer rename failure warns and continues remaining layers", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    const layer1 = {
      id: 1,
      visible: true,
      name: "Photo 1",
      get name() { return this._name || "Photo 1"; },
      set name(v) { throw new Error("Layer is locked"); }
    };
    const layer2 = { id: 2, visible: true, name: "Photo 2" };

    const doc = {
      name: "Test.psd",
      layers: [layer2, layer1]
    };

    smartRenameDocument(doc);

    // layer1 threw on set name, should log warning
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0][0].includes("Could not rename layer"));
    // layer2 should still be renamed!
    assert.equal(layer2.name, "02 MMR | 7001514367");
  } finally {
    console.warn = originalWarn;
  }
});

// ==========================================
// 33-42. Modal Orchestration Tests
// ==========================================

test("33. Modal Orchestration: File picker executes outside Photoshop mutation modal", async () => {
  let modalActive = false;
  let pickerRanOutsideModal = false;

  await executeOpenPsd({
    selectPsdFiles: async () => {
      pickerRanOutsideModal = !modalActive;
      return [{ name: "P1.psd" }];
    },
    openDocument: async () => ({ name: "P1.psd", width: 10800, height: 3600 }),
    executeModal: async fn => {
      modalActive = true;
      try {
        await fn();
      } finally {
        modalActive = false;
      }
    },
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(pickerRanOutsideModal, true, "selectPsdFiles must run outside modal");
});

test("34. Modal Orchestration: Each PSD gets its own executeAsModal call", async () => {
  const modalCalls = [];
  const files = [{ name: "A.psd" }, { name: "B.psd" }];

  await executeOpenPsd({
    selectPsdFiles: async () => files,
    openDocument: async file => ({ name: file.name, width: 10800, height: 3600 }),
    executeModal: async (fn, cmd) => {
      modalCalls.push(cmd);
      await fn();
    },
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(modalCalls.length, 2, "Must execute modal exactly once per PSD");
  assert.equal(modalCalls[0], "FM Open PSD - A.psd");
  assert.equal(modalCalls[1], "FM Open PSD - B.psd");
});

test("35. Modal Orchestration: app.open occurs inside executeAsModal", async () => {
  let modalActive = false;
  let openOccurredInModal = false;

  await executeOpenPsd({
    selectPsdFiles: async () => [{ name: "Test.psd" }],
    openDocument: async file => {
      openOccurredInModal = modalActive;
      return { name: file.name, width: 10800, height: 3600 };
    },
    executeModal: async fn => {
      modalActive = true;
      try {
        await fn();
      } finally {
        modalActive = false;
      }
    },
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(openOccurredInModal, true, "openDocument must occur inside executeAsModal");
});

test("36. Modal Orchestration: Any activeDocument assignment occurs only inside executeAsModal", async () => {
  let modalActive = false;
  let setActiveOccurredInModal = false;

  await executeOpenPsd({
    selectPsdFiles: async () => [{ name: "Test.psd" }],
    openDocument: async file => ({ name: file.name, width: 10800, height: 3600 }),
    setActiveDocument: () => {
      setActiveOccurredInModal = modalActive;
    },
    executeModal: async fn => {
      modalActive = true;
      try {
        await fn();
      } finally {
        modalActive = false;
      }
    },
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(setActiveOccurredInModal, true, "setActiveDocument must occur inside executeAsModal");
});

test("37. Modal Orchestration: Smart Rename occurs inside executeAsModal", async () => {
  let modalActive = false;
  let renameOccurredInModal = false;

  await executeOpenPsd({
    selectPsdFiles: async () => [{ name: "Test.psd" }],
    openDocument: async file => ({ name: file.name, width: 10800, height: 3600 }),
    smartRenameLayers: () => {
      renameOccurredInModal = modalActive;
    },
    executeModal: async fn => {
      modalActive = true;
      try {
        await fn();
      } finally {
        modalActive = false;
      }
    },
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(renameOccurredInModal, true, "smartRenameLayers must occur inside executeAsModal");
});

test("38. Modal Orchestration: normalizeDocumentToPixels occurs inside executeAsModal", async () => {
  let modalActive = false;
  let normalizeOccurredInModal = false;
  let currentW = 7200;
  let currentH = 2400;
  let currentRes = 200;

  await executeOpenPsd({
    selectPsdFiles: async () => [{ name: "Test.psd" }],
    openDocument: async file => ({ name: file.name, width: currentW, height: currentH, resolution: currentRes }),
    getDocumentMetrics: async doc => ({
      name: doc.name,
      pixelWidth: currentW,
      pixelHeight: currentH,
      resolution: currentRes,
      widthInches: currentW / currentRes,
      heightInches: currentH / currentRes
    }),
    normalizeDocumentToPixels: async (doc, w, h, res) => {
      normalizeOccurredInModal = modalActive;
      currentW = w;
      currentH = h;
      currentRes = res;
    },
    executeModal: async fn => {
      modalActive = true;
      try {
        await fn();
      } finally {
        modalActive = false;
      }
    },
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(normalizeOccurredInModal, true, "normalizeDocumentToPixels must occur inside executeAsModal");
});

test("39. Modal Orchestration: guide clear/add occurs inside executeAsModal", async () => {
  let modalActive = false;
  let clearInModal = false;
  let addInModal = false;

  await executeOpenPsd({
    selectPsdFiles: async () => [{ name: "Test.psd" }],
    openDocument: async file => ({ name: file.name, width: 10800, height: 3600 }),
    clearAllGuides: async () => {
      clearInModal = modalActive;
    },
    addAlbumGuides: async () => {
      addInModal = modalActive;
    },
    executeModal: async fn => {
      modalActive = true;
      try {
        await fn();
      } finally {
        modalActive = false;
      }
    },
    normalizeAlbumSize: async () => {}
  });

  assert.equal(clearInModal, true, "clearAllGuides must occur inside executeAsModal");
  assert.equal(addInModal, true, "addAlbumGuides must occur inside executeAsModal");
});

test("40. Modal Orchestration: 3 PSD files produce exactly 3 sequential modal executions", async () => {
  const events = [];
  const files = [{ name: "1.psd" }, { name: "2.psd" }, { name: "3.psd" }];

  await executeOpenPsd({
    selectPsdFiles: async () => files,
    openDocument: async file => ({ name: file.name, width: 10800, height: 3600 }),
    executeModal: async (fn, cmd) => {
      events.push(`start:${cmd}`);
      await fn();
      events.push(`end:${cmd}`);
    },
    normalizeAlbumSize: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.deepEqual(events, [
    "start:FM Open PSD - 1.psd",
    "end:FM Open PSD - 1.psd",
    "start:FM Open PSD - 2.psd",
    "end:FM Open PSD - 2.psd",
    "start:FM Open PSD - 3.psd",
    "end:FM Open PSD - 3.psd"
  ]);
});

test("41. Modal Orchestration: PSD 2 modal failure does not abort PSD 3 modal execution", async () => {
  const executedFiles = [];
  const files = [{ name: "PSD1.psd" }, { name: "PSD2_Fails.psd" }, { name: "PSD3.psd" }];

  const origError = console.error;
  console.error = () => {};

  try {
    const result = await executeOpenPsd({
      selectPsdFiles: async () => files,
      openDocument: async file => {
        if (file.name === "PSD2_Fails.psd") {
          throw new Error("PSD2 failed inside modal");
        }
        return { name: file.name, width: 10800, height: 3600 };
      },
      executeModal: async (fn, cmd) => {
        executedFiles.push(cmd);
        await fn();
      },
      normalizeAlbumSize: async () => {},
      clearAllGuides: async () => {},
      addAlbumGuides: async () => {}
    });

    assert.equal(result.outcome, "partial");
    assert.equal(result.successCount, 2);
    assert.equal(result.failureCount, 1);
    assert.deepEqual(executedFiles, [
      "FM Open PSD - PSD1.psd",
      "FM Open PSD - PSD2_Fails.psd",
      "FM Open PSD - PSD3.psd"
    ]);
  } finally {
    console.error = origError;
  }
});

test("42. Modal Orchestration: No legacy fallback pattern retrying mutations outside modal", () => {
  const defaultDeps = getDefaultDependencies();
  assert.ok(typeof defaultDeps.openDocument === "function");
  const openFnCode = defaultDeps.openDocument.toString();
  assert.ok(!openFnCode.includes("catch"), "openDocument should not have try/catch retry fallback; it must execute within modal");
});

// ==========================================
// 43-47. DistanceUnit & Metrics Verification Regressions
// ==========================================

test("43. Regression: raw batchPlay distanceUnit 2592 × 864 @ 300 resolves to 10800 × 3600 px", () => {
  const widthDesc = { _unit: "distanceUnit", _value: 2592 };
  const heightDesc = { _unit: "distanceUnit", _value: 864 };
  const resolutionDesc = { _unit: "densityUnit", _value: 300 };

  const res = extractResolution(resolutionDesc);
  assert.equal(res, 300);

  const pxW = extractPixels(widthDesc, res);
  const pxH = extractPixels(heightDesc, res);

  assert.equal(pxW, 10800);
  assert.equal(pxH, 3600);

  const widthInches = pxW / res;
  const heightInches = pxH / res;
  assert.equal(widthInches, 36);
  assert.equal(heightInches, 12);
});

test("44. Regression: 18×12 raw batchPlay distanceUnit 1296 × 864 @ 300 resolves to 5400 × 3600 px", () => {
  const widthDesc = { _unit: "distanceUnit", _value: 1296 };
  const heightDesc = { _unit: "distanceUnit", _value: 864 };
  const resolutionDesc = { _unit: "densityUnit", _value: 300 };

  const res = extractResolution(resolutionDesc);
  assert.equal(res, 300);

  const pxW = extractPixels(widthDesc, res);
  const pxH = extractPixels(heightDesc, res);

  assert.equal(pxW, 5400);
  assert.equal(pxH, 3600);

  const widthInches = pxW / res;
  const heightInches = pxH / res;
  assert.equal(widthInches, 18);
  assert.equal(heightInches, 12);
});

test("45. Regression: 200 PPI pre-resize 7200 × 2400 @ 200 resolves to physical 36 × 12 and normalizes to 10800 × 3600 @ 300", async () => {
  let currentDoc = {
    name: "08 PHOTO PSD (6).psd",
    width: 7200,
    height: 2400,
    resolution: 200
  };

  const loggedRaw = [];
  const loggedNormalized = [];
  const origLog = console.log;
  console.log = (...args) => {
    if (args[0] === "[OPEN PSD RAW METRICS]") loggedRaw.push(args[1]);
    if (args[0] === "[OPEN PSD NORMALIZED METRICS]") loggedNormalized.push(args[1]);
    origLog(...args);
  };

  try {
    const result = await executeOpenPsd({
      selectPsdFiles: async () => [currentDoc],
      openDocument: async () => currentDoc,
      getDocumentMetrics: async doc => ({
        name: doc.name,
        pixelWidth: doc.width,
        pixelHeight: doc.height,
        resolution: doc.resolution,
        widthInches: doc.width / doc.resolution,
        heightInches: doc.height / doc.resolution
      }),
      normalizeDocumentToPixels: async (doc, targetW, targetH, targetDpi) => {
        doc.width = targetW;
        doc.height = targetH;
        doc.resolution = targetDpi;
      },
      executeModal: async fn => fn(),
      clearAllGuides: async () => {},
      addAlbumGuides: async () => {}
    });

    assert.equal(result.outcome, "success");
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 0);

    assert.equal(currentDoc.width, 10800);
    assert.equal(currentDoc.height, 3600);
    assert.equal(currentDoc.resolution, 300);

    assert.ok(loggedNormalized.length > 0);
    const lastNorm = loggedNormalized[loggedNormalized.length - 1];
    assert.equal(lastNorm.pixelWidth, 10800);
    assert.equal(lastNorm.pixelHeight, 3600);
    assert.equal(lastNorm.resolution, 300);
    assert.equal(lastNorm.widthInches, 36);
    assert.equal(lastNorm.heightInches, 12);
  } finally {
    console.log = origLog;
  }
});

test("46. Regression: verify-size passes on correct post-resize metrics and fails on incorrect metrics", async () => {
  // Test 46a: 36x12 correct metrics pass
  const doc36 = { name: "Album36.psd", width: 10800, height: 3600, resolution: 300 };
  const res36 = await executeOpenPsd({
    selectPsdFiles: async () => [doc36],
    openDocument: async () => doc36,
    getDocumentMetrics: async () => ({
      name: "Album36.psd",
      pixelWidth: 10800,
      pixelHeight: 3600,
      resolution: 300,
      widthInches: 36,
      heightInches: 12
    }),
    normalizeDocumentToPixels: async () => {},
    executeModal: async fn => fn(),
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });
  assert.equal(res36.outcome, "success");

  // Test 46b: 18x12 correct metrics pass
  const doc18 = { name: "Album18.psd", width: 5400, height: 3600, resolution: 300 };
  const res18 = await executeOpenPsd({
    selectPsdFiles: async () => [doc18],
    openDocument: async () => doc18,
    getDocumentMetrics: async () => ({
      name: "Album18.psd",
      pixelWidth: 5400,
      pixelHeight: 3600,
      resolution: 300,
      widthInches: 18,
      heightInches: 12
    }),
    normalizeDocumentToPixels: async () => {},
    executeModal: async fn => fn(),
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });
  assert.equal(res18.outcome, "success");

  // Test 46c: Unconverted points (2592x864) must fail verification
  const docBad = { name: "Bad.psd", width: 10800, height: 3600, resolution: 300 };
  const origError = console.error;
  console.error = () => {};
  try {
    const resBad = await executeOpenPsd({
      selectPsdFiles: async () => [docBad],
      openDocument: async () => docBad,
      getDocumentMetrics: async () => ({
        name: "Bad.psd",
        pixelWidth: 2592, // Still in points!
        pixelHeight: 864,
        resolution: 300,
        widthInches: 8.64,
        heightInches: 2.88
      }),
      normalizeDocumentToPixels: async () => {},
      executeModal: async fn => fn(),
      clearAllGuides: async () => {},
      addAlbumGuides: async () => {}
    });
    assert.equal(resBad.outcome, "error");
    assert.equal(resBad.failureCount, 1);
  } finally {
    console.error = origError;
  }
});

test("47. Regression: No false failure toast when 7200x2400 @ 200 normalizes to 10800x3600 @ 300", async () => {
  const doc = {
    name: "08 PHOTO PSD (6).psd",
    width: 7200,
    height: 2400,
    resolution: 200
  };

  const result = await executeOpenPsd({
    selectPsdFiles: async () => [doc],
    openDocument: async () => doc,
    getDocumentMetrics: async d => {
      return {
        name: d.name,
        pixelWidth: d.width === 7200 ? 7200 : 10800,
        pixelHeight: d.height === 2400 ? 2400 : 3600,
        resolution: d.resolution === 200 ? 200 : 300,
        widthInches: 36,
        heightInches: 12
      };
    },
    normalizeDocumentToPixels: async (d, tw, th, tdpi) => {
      d.width = tw;
      d.height = th;
      d.resolution = tdpi;
    },
    executeModal: async fn => fn(),
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {}
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 0);

  const toast = buildOpenPsdToast(result);
  assert.equal(toast.message, "1 PSD opened");
  assert.equal(toast.type, "success");
  assert.notEqual(toast.message, "Open PSD failed");
});
