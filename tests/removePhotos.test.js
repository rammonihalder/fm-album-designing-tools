"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  PHOTO_NAME_KEYWORDS,
  nameMatchesPhotoFilter,
  isGroupLayer,
  isClippingLayer,
  isSmartObjectLayer,
  isRemovePhotoCandidate,
  collectRemovePhotoCandidates,
  buildRemovePhotosToast,
  executeRemovePhotos
} = require("../src/tools/removePhotos");

function createMainHarness({ runRemovePhotosOutcome = { outcome: "success", removedCount: 1, failedCount: 0 } } = {}) {
  const elements = new Map();
  const ids = [
    "openPsdBtn", "autoPhotoFillBtn", "swapPhotosBtn", "flipPhotoBtn", "savePageBtn", "saveEditedPhotosBtn", "savePsdCategoryBtn", "removePhotosBtn",
    "statusText", "toast",
    "savePageDialog", "savePagePrefixInput", "savePagePrefixError", "savePageDialogSaveBtn", "savePageDialogCancelBtn",
    "savePageFolderDialog", "savePageLastFolderPath", "savePageUseFolderBtn", "savePageChangeFolderBtn", "savePageFolderCancelBtn",
    "saveEditedFolderDialog", "saveEditedLastFolderPath", "saveEditedUseFolderBtn", "saveEditedChangeFolderBtn", "saveEditedFolderCancelBtn",
    "savePsdCategoryFolderDialog", "savePsdCategoryLastFolderPath", "savePsdCategoryUseFolderBtn", "savePsdCategoryChangeFolderBtn", "savePsdCategoryFolderCancelBtn",
    "savePsdCategoryDeviceDialog", "deviceLtBtn", "devicePcBtn", "deviceCustomBtn", "customDeviceInputContainer", "customDeviceInput", "savePsdCategoryDeviceSaveBtn", "savePsdCategoryDeviceCancelBtn",
    "savePsdCategoryDialog", "savePsdCategorySelect", "savePsdCustomNameInput", "savePsdDeleteOriginalCheckbox", "savePsdDeleteWarning", "savePsdDialogSaveBtn", "savePsdDialogCancelBtn",
    "savePsdOrientationDialog", "orientationLandscapeInput", "orientationPortraitInput", "orientationSquareInput", "orientationContinueBtn", "orientationCancelBtn",
    "savePsdDeleteConfirmDialog", "savePsdConfirmDeleteBtn", "savePsdCancelDeleteBtn",
    "editedPhotosDeviceDialog", "editedPhotosDeviceLaptopBtn", "editedPhotosDeviceDesktopBtn", "editedPhotosDeviceCancelBtn"
  ];
  for (const id of ids) {
    elements.set(id, {
      id,
      children: [],
      textContent: "",
      className: "",
      hidden: id === "savePagePrefixError",
      disabled: false,
      value: "",
      listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      removeEventListener(event, handler) { delete this.listeners[event]; }
    });
  }

  const context = {
    console,
    clearTimeout,
    setTimeout,
    document: {
      getElementById: id => elements.get(id) || null
    },
    require: name => {
      if (name === "./src/tools/openPsd") {
        return {
          runOpenPsd: async () => ({ outcome: "success" }),
          buildOpenPsdToast: () => ({ message: "1 PSD opened", type: "success" })
        };
      }
      if (name === "./src/tools/autoPhotoFill") {
        return {
          runAutoPhotoFill: async () => ({ outcome: "success" }),
          buildAutoPhotoFillToast: () => ({ message: "Filled", type: "success" })
        };
      }
      if (name === "./src/tools/swapPhotos") {
        return {
          runSwapPhotos: async () => ({ success: true, count: 2, message: "2 photos swapped" })
        };
      }
      if (name === "./src/tools/flipPhoto") {
        return {
          runFlipPhoto: async () => ({ outcome: "success", flippedCount: 1, skippedCount: 0 })
        };
      }
      if (name === "./src/tools/savePage") {
        return {
          runSavePage: async () => ({ outcome: "success", fileName: "MMRLT1" }),
          buildSavePageToast: () => ({ message: "Saved: MMRLT1", type: "success" }),
          isValidPrefix: () => true
        };
      }
      if (name === "./src/tools/saveEditedPhotos") {
        return {
          runSaveEditedPhotos: async () => ({ outcome: "success", successCount: 1, failedCount: 0 }),
          buildSaveEditedPhotosToast: () => ({ message: "1 edited photo saved", type: "success" })
        };
      }
      if (name === "./src/tools/savePsdCategory") {
        return {
          runSavePsdCategory: async () => ({ outcome: "success", fileName: "MMR 3 PHOTOS 01 PC.psd" })
        };
      }
      if (name === "./src/tools/removePhotos") {
        return {
          runRemovePhotos: async () => runRemovePhotosOutcome,
          buildRemovePhotosToast: res => ({ message: res.removedCount ? `${res.removedCount} photos removed` : "Photo removal failed", type: "success" })
        };
      }
      if (name === "./src/ui/toast") {
        return require("../src/ui/toast");
      }
      throw new Error("Unexpected require: " + name);
    }
  };

  const scriptSource = fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8");
  vm.createContext(context);
  vm.runInContext(scriptSource, context);

  return { elements, sandbox: context };
}

// ==========================================
// 1-5: VERSION / BUTTON TESTS
// ==========================================

test("1. REMOVE PHOTOS button exists in index.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(/id="removePhotosBtn"/i.test(html), "index.html must have removePhotosBtn");
  assert.ok(html.includes("REMOVE PHOTOS"), "button label must be REMOVE PHOTOS");
});

test("2. Exact button order: OPEN PSD -> AUTO PHOTO FILL -> SWAP PHOTOS -> FLIP PHOTO -> SAVE PAGE -> SAVE EDITED PHOTOS -> SAVE PSD CATEGORY -> REMOVE PHOTOS", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const openPos = html.indexOf('id="openPsdBtn"');
  const autoPos = html.indexOf('id="autoPhotoFillBtn"');
  const swapPos = html.indexOf('id="swapPhotosBtn"');
  const flipPos = html.indexOf('id="flipPhotoBtn"');
  const savePos = html.indexOf('id="savePageBtn"');
  const saveEditedPos = html.indexOf('id="saveEditedPhotosBtn"');
  const savePsdCategoryPos = html.indexOf('id="savePsdCategoryBtn"');
  const removePos = html.indexOf('id="removePhotosBtn"');

  assert.ok(openPos !== -1, "openPsdBtn must exist");
  assert.ok(autoPos !== -1, "autoPhotoFillBtn must exist");
  assert.ok(swapPos !== -1, "swapPhotosBtn must exist");
  assert.ok(flipPos !== -1, "flipPhotoBtn must exist");
  assert.ok(savePos !== -1, "savePageBtn must exist");
  assert.ok(saveEditedPos !== -1, "saveEditedPhotosBtn must exist");
  assert.ok(savePsdCategoryPos !== -1, "savePsdCategoryBtn must exist");
  assert.ok(removePos !== -1, "removePhotosBtn must exist");

  assert.ok(openPos < autoPos, "openPsdBtn must be before autoPhotoFillBtn");
  assert.ok(autoPos < swapPos, "autoPhotoFillBtn must be before swapPhotosBtn");
  assert.ok(swapPos < flipPos, "swapPhotosBtn must be before flipPhotoBtn");
  assert.ok(flipPos < savePos, "flipPhotoBtn must be before savePageBtn");
  assert.ok(savePos < saveEditedPos, "savePageBtn must be before saveEditedPhotosBtn");
  assert.ok(saveEditedPos < savePsdCategoryPos, "saveEditedPhotosBtn must be before savePsdCategoryBtn");
  assert.ok(savePsdCategoryPos < removePos, "savePsdCategoryBtn must be before removePhotosBtn");
});

test("3. Visible version is present in index.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes("v1.4.2") || html.includes("v1.3.0") || html.includes("v1.2.0") || html.includes("v1.1.0"), "index.html must display version");
});

test("4. Manifest version is valid", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
  assert.ok(manifest.version === "1.4.2" || manifest.version === "1.3.0" || manifest.version === "1.2.0" || manifest.version === "1.1.0", "manifest.json version must be valid");
});

test("5. Plugin ID unchanged", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
  assert.equal(manifest.id, "9beaddeb", "plugin ID must be 9beaddeb for Adobe Marketplace build");
});

// ==========================================
// 6-16: NAME MATCHING TESTS
// ==========================================

test("6-16. nameMatchesPhotoFilter matches keywords case-insensitively and rejects non-matches", () => {
  assert.equal(nameMatchesPhotoFilter("IMG_1234"), true, "6. IMG_1234 -> true");
  assert.equal(nameMatchesPhotoFilter("img_1234"), true, "7. img_1234 -> true");
  assert.equal(nameMatchesPhotoFilter("DSC_999"), true, "8. DSC_999 -> true");
  assert.equal(nameMatchesPhotoFilter("Wedding PHOTO 1"), true, "9. Wedding PHOTO 1 -> true");
  assert.equal(nameMatchesPhotoFilter("Bride.JPG"), true, "10. Bride.JPG -> true");
  assert.equal(nameMatchesPhotoFilter("Bride.jpeg"), true, "11. Bride.jpeg -> true");
  assert.equal(nameMatchesPhotoFilter("abcIMGxyz"), true, "12. abcIMGxyz -> true");
  assert.equal(nameMatchesPhotoFilter("MyDSCFile"), true, "13. MyDSCFile -> true");
  assert.equal(nameMatchesPhotoFilter("Wedding"), false, "14. Wedding -> false");
  assert.equal(nameMatchesPhotoFilter("Bride.png"), false, "15. Bride.png -> false");
  assert.equal(nameMatchesPhotoFilter("MMRLT"), false, "16. MMRLT -> false");
  assert.equal(nameMatchesPhotoFilter(""), false);
  assert.equal(nameMatchesPhotoFilter(null), false);
  assert.equal(nameMatchesPhotoFilter(undefined), false);
});

// ==========================================
// 17-20: ALL THREE CONDITIONS TESTS
// ==========================================

test("17. Smart Object = true, Clipping = true, Name match = true -> candidate true", () => {
  const layer = {
    id: 101,
    name: "IMG_001",
    kind: "smartObject",
    isClippingMask: true
  };
  assert.equal(isRemovePhotoCandidate(layer), true);
});

test("18. Smart Object = false, Clipping = true, Name match = true -> false", () => {
  const layer = {
    id: 102,
    name: "IMG_002",
    kind: "normal",
    isClippingMask: true
  };
  assert.equal(isRemovePhotoCandidate(layer), false);
});

test("19. Smart Object = true, Clipping = false, Name match = true -> false", () => {
  const layer = {
    id: 103,
    name: "IMG_003",
    kind: "smartObject",
    isClippingMask: false
  };
  assert.equal(isRemovePhotoCandidate(layer), false);
});

test("20. Smart Object = true, Clipping = true, Name match = false -> false", () => {
  const layer = {
    id: 104,
    name: "Wedding",
    kind: "smartObject",
    isClippingMask: true
  };
  assert.equal(isRemovePhotoCandidate(layer), false);
});

// ==========================================
// 21-24: GROUPS TESTS
// ==========================================

test("21. Matching group name does NOT make group a candidate", () => {
  const group = {
    id: 201,
    name: "IMG Group",
    layers: [],
    typename: "LayerSet",
    isClippingMask: true
  };
  assert.equal(isRemovePhotoCandidate(group), false);
});

test("22. Child matching layer inside one group is found", () => {
  const matchingChild = { id: 301, name: "IMG_111", kind: "smartObject", isClippingMask: true };
  const nonMatchingChild = { id: 302, name: "Frame", kind: "normal", isClippingMask: false };
  const group = {
    id: 202,
    name: "Group 1",
    layers: [matchingChild, nonMatchingChild]
  };

  const candidates = collectRemovePhotoCandidates(group);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 301);
});

test("23 & 24. Arbitrarily nested group traversal finds matching child inside nested groups", () => {
  const deeplyNested = { id: 401, name: "DSC_999", kind: "smartObject", grouped: true };
  const subSubGroup = { id: 503, name: "SubSub", layers: [deeplyNested] };
  const subGroup = { id: 502, name: "Sub", layers: [subSubGroup] };
  const rootGroup = { id: 501, name: "Root", layers: [subGroup] };

  const candidates = collectRemovePhotoCandidates(rootGroup);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 401);
});

// ==========================================
// 25: VISIBILITY TEST
// ==========================================

test("25. Hidden Smart Object + clipping + matching name still qualifies", () => {
  const hiddenLayer = {
    id: 601,
    name: "PHOTO_Hidden",
    kind: "smartObject",
    isClippingMask: true,
    visible: false
  };
  assert.equal(isRemovePhotoCandidate(hiddenLayer), true, "hidden matching layer must qualify");
});

// ==========================================
// 26-27: SELECTION INDEPENDENCE
// ==========================================

test("26 & 27. Unselected matching layers across document are discovered independently of selection", () => {
  const unselected1 = { id: 701, name: "IMG_Unselected1", kind: "smartObject", isClippingMask: true };
  const unselected2 = { id: 702, name: "DSC_Unselected2", kind: "smartObject", isClippingMask: true };
  const selectedOther = { id: 703, name: "OtherSelected", kind: "normal" };

  const doc = {
    id: 1,
    layers: [unselected1, unselected2, selectedOther],
    activeLayers: [selectedOther]
  };

  const candidates = collectRemovePhotoCandidates(doc);
  assert.equal(candidates.length, 2);
  const ids = candidates.map(c => c.id);
  assert.ok(ids.includes(701) && ids.includes(702));
});

// ==========================================
// 28: NO DOCUMENT
// ==========================================

test("28. No document: zero deletion calls, toast = Open a document first", async () => {
  let deleteCalled = false;
  const result = await executeRemovePhotos({
    app: { activeDocument: null },
    getActiveDocument: () => null,
    deleteLayer: async () => { deleteCalled = true; }
  });

  assert.equal(result.outcome, "no-document");
  assert.equal(deleteCalled, false);
  const toast = buildRemovePhotosToast(result);
  assert.equal(toast.message, "Open a document first");
  assert.equal(toast.type, "warning");
});

// ==========================================
// 29: NO MATCH
// ==========================================

test("29. No candidates: zero delete commands, toast = No matching photos found", async () => {
  let deleteCalled = false;
  const doc = {
    id: 1,
    name: "Doc.psd",
    layers: [
      { id: 10, name: "Background", isBackgroundLayer: true },
      { id: 11, name: "Text", kind: "text" },
      { id: 12, name: "Wedding", kind: "smartObject", isClippingMask: true }
    ]
  };

  const result = await executeRemovePhotos({
    app: { activeDocument: doc, documents: [doc] },
    getActiveDocument: () => doc,
    deleteLayer: async () => { deleteCalled = true; }
  });

  assert.equal(result.outcome, "no-matches");
  assert.equal(deleteCalled, false);
  const toast = buildRemovePhotosToast(result);
  assert.equal(toast.message, "No matching photos found");
  assert.equal(toast.type, "info");
});

// ==========================================
// 30-35: DELETE TESTS
// ==========================================

test("30-35. Deletes matching candidates by ID; preserves non-matching, groups, unclipped SO, clipped pixel", async () => {
  const deletedIds = [];

  const candidate1 = { id: 101, name: "IMG_1234", kind: "smartObject", isClippingMask: true };
  const candidate2 = { id: 102, name: "DSC_5555", kind: "smartObject", isClippingMask: true };
  const nonMatchingSO = { id: 103, name: "Wedding", kind: "smartObject", isClippingMask: true };
  const unclippedSO = { id: 104, name: "IMG_9999", kind: "smartObject", isClippingMask: false };
  const clippedPixel = { id: 105, name: "PHOTO 1", kind: "normal", isClippingMask: true };
  const group = { id: 106, name: "IMG Group", layers: [candidate2], typename: "LayerSet" };

  const doc = {
    id: 55,
    name: "Album.psd",
    layers: [candidate1, nonMatchingSO, unclippedSO, clippedPixel, group]
  };

  const result = await executeRemovePhotos({
    app: { activeDocument: doc, documents: [doc] },
    getActiveDocument: () => doc,
    deleteLayer: async (id, targetDoc) => {
      deletedIds.push(id);
    }
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.removedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(deletedIds.sort(), [101, 102]);
  assert.ok(!deletedIds.includes(103), "Wedding SO must remain untouched");
  assert.ok(!deletedIds.includes(104), "unclipped SO must remain untouched");
  assert.ok(!deletedIds.includes(105), "clipped pixel must remain untouched");
  assert.ok(!deletedIds.includes(106), "group must remain untouched");

  const toast = buildRemovePhotosToast(result);
  assert.equal(toast.message, "2 photos removed");
  assert.equal(toast.type, "success");
});

// ==========================================
// 36-40: FAILURE ISOLATION TESTS
// ==========================================

test("36-40. One candidate delete throws: later candidate still attempted, partial toast shown", async () => {
  const candidate1 = { id: 101, name: "IMG_1", kind: "smartObject", isClippingMask: true };
  const candidate2 = { id: 102, name: "IMG_2", kind: "smartObject", isClippingMask: true };
  const candidate3 = { id: 103, name: "IMG_3", kind: "smartObject", isClippingMask: true };

  const doc = {
    id: 55,
    name: "Album.psd",
    layers: [candidate1, candidate2, candidate3]
  };

  const attemptIds = [];

  const result = await executeRemovePhotos({
    app: { activeDocument: doc, documents: [doc] },
    getActiveDocument: () => doc,
    deleteLayer: async (id) => {
      attemptIds.push(id);
      if (id === 102) {
        throw new Error("Layer 102 locked");
      }
    }
  });

  assert.equal(result.outcome, "partial");
  assert.equal(result.removedCount, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(attemptIds.length, 3, "all 3 candidates must be attempted");

  const toast = buildRemovePhotosToast(result);
  assert.equal(toast.message, "2 removed • 1 failed");
  assert.equal(toast.type, "warning");
});

test("40. All candidate deletes fail: Photo removal failed toast", async () => {
  const candidate = { id: 101, name: "IMG_Fail", kind: "smartObject", isClippingMask: true };
  const doc = { id: 1, name: "Doc", layers: [candidate] };

  const result = await executeRemovePhotos({
    app: { activeDocument: doc, documents: [doc] },
    getActiveDocument: () => doc,
    deleteLayer: async () => { throw new Error("Permission error"); }
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.removedCount, 0);
  assert.equal(result.failedCount, 1);
  const toast = buildRemovePhotosToast(result);
  assert.equal(toast.message, "Photo removal failed");
  assert.equal(toast.type, "error");
});

// ==========================================
// 41-43: MODAL SCOPE
// ==========================================

test("41-43. Photoshop deletion executed inside executeAsModal", async () => {
  let inModal = false;
  let deleteInsideModal = false;

  const candidate = { id: 101, name: "IMG_Test", kind: "smartObject", isClippingMask: true };
  const doc = { id: 1, name: "Doc", layers: [candidate] };

  await executeRemovePhotos({
    app: { activeDocument: doc, documents: [doc] },
    getActiveDocument: () => doc,
    executeModal: async (fn, cmd) => {
      inModal = true;
      try {
        return await fn({ hostControl: {} });
      } finally {
        inModal = false;
      }
    },
    deleteLayer: async () => {
      deleteInsideModal = inModal;
    }
  });

  assert.equal(deleteInsideModal, true, "deletion must take place inside executeAsModal");
});

// ==========================================
// 44: HISTORY SUSPENSION
// ==========================================

test("44. History suspension wraps operation into one named state: Remove Photos", async () => {
  let suspendedName = null;
  let resumed = false;

  const candidate = { id: 101, name: "IMG_Hist", kind: "smartObject", isClippingMask: true };
  const doc = { id: 77, name: "Doc", layers: [candidate] };

  await executeRemovePhotos({
    app: { activeDocument: doc, documents: [doc] },
    getActiveDocument: () => doc,
    executeModal: async (fn) => {
      return fn({
        hostControl: {
          suspendHistory: async options => {
            suspendedName = options.name;
            return "token-1";
          },
          resumeHistory: async token => {
            if (token === "token-1") resumed = true;
          }
        }
      });
    },
    deleteLayer: async () => {}
  });

  assert.equal(suspendedName, "Remove Photos");
  assert.equal(resumed, true);
});

// ==========================================
// 45-47: BUTTON LOCKING
// ==========================================

test("45-47. All 6 buttons disabled during REMOVE PHOTOS and re-enabled in finally", async () => {
  const h = createMainHarness();
  const removeBtn = h.elements.get("removePhotosBtn");
  const openBtn = h.elements.get("openPsdBtn");
  const autoBtn = h.elements.get("autoPhotoFillBtn");
  const swapBtn = h.elements.get("swapPhotosBtn");
  const savePageBtn = h.elements.get("savePageBtn");
  const saveEditedBtn = h.elements.get("saveEditedPhotosBtn");

  const promise = h.sandbox.handleRemovePhotos();

  assert.equal(removeBtn.disabled, true);
  assert.equal(openBtn.disabled, true);
  assert.equal(autoBtn.disabled, true);
  assert.equal(swapBtn.disabled, true);
  assert.equal(savePageBtn.disabled, true);
  assert.equal(saveEditedBtn.disabled, true);

  await promise;

  assert.equal(removeBtn.disabled, false);
  assert.equal(openBtn.disabled, false);
  assert.equal(autoBtn.disabled, false);
  assert.equal(swapBtn.disabled, false);
  assert.equal(savePageBtn.disabled, false);
  assert.equal(saveEditedBtn.disabled, false);
});

// ==========================================
// TOAST MESSAGES
// ==========================================

test("Toast messages match specification", () => {
  assert.equal(buildRemovePhotosToast({ outcome: "no-document" }).message, "Open a document first");
  assert.equal(buildRemovePhotosToast({ outcome: "no-matches" }).message, "No matching photos found");
  assert.equal(buildRemovePhotosToast({ outcome: "success", removedCount: 1 }).message, "1 photo removed");
  assert.equal(buildRemovePhotosToast({ outcome: "success", removedCount: 3 }).message, "3 photos removed");
  assert.equal(buildRemovePhotosToast({ outcome: "partial", removedCount: 3, failedCount: 1 }).message, "3 removed • 1 failed");
  assert.equal(buildRemovePhotosToast({ outcome: "failed" }).message, "Photo removal failed");
  assert.equal(buildRemovePhotosToast({ outcome: "error" }).message, "Photo removal failed");
});
