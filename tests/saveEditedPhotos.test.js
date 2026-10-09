"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  FOLDER_TOKEN_KEY,
  DEVICE_STORAGE_KEY,
  FILENAME_REGEX,
  normalizeDeviceType,
  isValidDeviceType,
  getStoredDeviceType,
  saveDeviceType,
  extractEditedPhotoNumber,
  findNextEditedPhotoNumber,
  buildEditedPhotoFileName,
  isSmartObjectLayer,
  buildSaveEditedPhotosToast,
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  DocumentClosedError,
  executeSaveEditedPhotos
} = require("../src/tools/saveEditedPhotos");

function createMockFolder(name = "root", initialFiles = []) {
  const fileEntries = new Map();
  for (const fn of initialFiles) {
    fileEntries.set(fn, { name: fn, isFile: true, isFolder: false });
  }

  return {
    name,
    isFolder: true,
    isFile: false,
    _files: fileEntries,
    async getEntries() {
      return Array.from(fileEntries.values());
    },
    async createFile(fileName, options = {}) {
      if (options.overwrite === false && fileEntries.has(fileName)) {
        const err = new Error(`File "${fileName}" already exists`);
        err.code = "EEXIST";
        throw err;
      }
      const entry = {
        name: fileName,
        isFile: true,
        isFolder: false,
        parent: this,
        deleted: false,
        async delete() {
          this.deleted = true;
          fileEntries.delete(fileName);
        }
      };
      fileEntries.set(fileName, entry);
      return entry;
    }
  };
}

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
    _store: store
  };
}

function createMainHarness({ runSaveEditedPhotosOutcome = { outcome: "success", successCount: 1, failedCount: 0 } } = {}) {
  const elements = new Map();
  const ids = [
    "openPsdBtn", "autoPhotoFillBtn", "swapPhotosBtn", "flipPhotoBtn", "savePageBtn", "saveEditedPhotosBtn", "savePsdCategoryBtn", "removePhotosBtn", "statusText", "toast",
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
        return { runSwapPhotos: async () => ({ success: true }) };
      }
      if (name === "./src/tools/flipPhoto") {
        return { runFlipPhoto: async () => ({ outcome: "success", flippedCount: 1, skippedCount: 0 }) };
      }
      if (name === "./src/tools/savePage") {
        return {
          runSavePage: async () => ({ outcome: "success" }),
          buildSavePageToast: () => ({ message: "Saved: MMRLT1", type: "success" }),
          isValidPrefix: () => true
        };
      }
      if (name === "./src/tools/saveEditedPhotos") {
        return {
          runSaveEditedPhotos: async () => runSaveEditedPhotosOutcome,
          buildSaveEditedPhotosToast
        };
      }
      if (name === "./src/tools/savePsdCategory") {
        return {
          runSavePsdCategory: async () => ({ outcome: "success", fileName: "MMR 3 PHOTOS 01 PC.psd" })
        };
      }
      if (name === "./src/tools/removePhotos") {
        return {
          runRemovePhotos: async () => ({ outcome: "success", removedCount: 1, failedCount: 0 }),
          buildRemovePhotosToast: () => ({ message: "1 photo removed", type: "success" })
        };
      }
      if (name === "./src/ui/toast") {
        return require("../src/ui/toast");
      }
      throw new Error("Unexpected require: " + name);
    }
  };

  const sandbox = vm.createContext(context);
  const code = fs.readFileSync(require.resolve("../main"), "utf8");
  vm.runInContext(code, sandbox);

  return {
    elements,
    sandbox
  };
}

// ==========================================
// 1-5: BUTTON / VERSION
// ==========================================

test("1. SAVE EDITED PHOTOS button exists in index.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(/id="saveEditedPhotosBtn"/i.test(html), "index.html must have saveEditedPhotosBtn");
  assert.ok(html.includes("SAVE EDITED PHOTOS"), "button label must be SAVE EDITED PHOTOS");
});

test("2. Exact button order: OPEN PSD -> AUTO PHOTO FILL -> SWAP PHOTOS -> SAVE PAGE -> SAVE EDITED PHOTOS", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const openPos = html.indexOf('id="openPsdBtn"');
  const autoPos = html.indexOf('id="autoPhotoFillBtn"');
  const swapPos = html.indexOf('id="swapPhotosBtn"');
  const savePos = html.indexOf('id="savePageBtn"');
  const saveEditedPos = html.indexOf('id="saveEditedPhotosBtn"');

  assert.ok(openPos !== -1, "openPsdBtn must exist");
  assert.ok(autoPos !== -1, "autoPhotoFillBtn must exist");
  assert.ok(swapPos !== -1, "swapPhotosBtn must exist");
  assert.ok(savePos !== -1, "savePageBtn must exist");
  assert.ok(saveEditedPos !== -1, "saveEditedPhotosBtn must exist");

  assert.ok(openPos < autoPos, "openPsdBtn must be before autoPhotoFillBtn");
  assert.ok(autoPos < swapPos, "autoPhotoFillBtn must be before swapPhotosBtn");
  assert.ok(swapPos < savePos, "swapPhotosBtn must be before savePageBtn");
  assert.ok(savePos < saveEditedPos, "savePageBtn must be before saveEditedPhotosBtn");
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
// 6-10: DOCUMENT / SELECTION
// ==========================================

test("6. No document: no folder picker called, toast = Open a document first", async () => {
  let pickerCalled = false;
  const result = await executeSaveEditedPhotos({
    app: { activeDocument: null, documents: [] },
    selectFolder: async () => {
      pickerCalled = true;
      return createMockFolder();
    }
  });

  assert.equal(pickerCalled, false, "folder picker must not be called when no document is open");
  assert.equal(result.outcome, "no-document");

  const toast = buildSaveEditedPhotosToast(result);
  assert.equal(toast.message, "Open a document first");
  assert.equal(toast.type, "warning");
});

test("7 & 8. Selected layer IDs and main document ID captured before folder picker", async () => {
  let capturedDocIdAtPicker = null;
  let capturedLayerIdsAtPicker = null;

  const smart1 = { id: 101, kind: "smartObject", name: "Photo 1" };
  const smart2 = { id: 102, kind: "smartObject", name: "Photo 2" };
  const mainDoc = {
    id: 99,
    name: "Album.psd",
    layers: [smart1, smart2],
    activeLayers: [smart1, smart2]
  };

  const app = {
    activeDocument: mainDoc,
    documents: [mainDoc]
  };

  const folder = createMockFolder("Exports");

  await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, smart2],
    selectFolder: async () => {
      capturedDocIdAtPicker = mainDoc.id;
      capturedLayerIdsAtPicker = [smart1.id, smart2.id];
      return folder;
    },
    openSmartObject: async () => {},
    closeSmartObject: async () => {},
    saveJpeg: async () => {},
    selectLayer: async () => {},
    selectLayers: async () => {}
  });

  assert.equal(capturedDocIdAtPicker, 99);
  assert.deepEqual(capturedLayerIdsAtPicker, [101, 102]);
});

test("9. No selected Smart Objects: no exports, toast = Select Smart Object layers", async () => {
  let pickerCalled = false;
  const textLayer = { id: 201, kind: "text", name: "Title" };
  const mainDoc = {
    id: 1,
    name: "Page.psd",
    layers: [textLayer],
    activeLayers: [textLayer]
  };

  const result = await executeSaveEditedPhotos({
    app: { activeDocument: mainDoc, documents: [mainDoc] },
    getSelectedLayers: () => [textLayer],
    selectFolder: async () => {
      pickerCalled = true;
      return createMockFolder();
    }
  });

  assert.equal(pickerCalled, false, "folder picker must not open when no Smart Objects selected");
  assert.equal(result.outcome, "no-smart-objects");

  const toast = buildSaveEditedPhotosToast(result);
  assert.equal(toast.message, "Select Smart Object layers");
  assert.equal(toast.type, "warning");
});

test("10. Non-Smart-Object selected layers skipped", async () => {
  const smart1 = { id: 101, kind: "smartObject", name: "Photo 1" };
  const textLayer = { id: 201, kind: "text", name: "Text" };
  const smart2 = { id: 102, kind: "smartObject", name: "Photo 2" };

  const processedLayerIds = [];
  const mainDoc = {
    id: 1,
    name: "Doc.psd",
    layers: [smart1, textLayer, smart2],
    activeLayers: [smart1, textLayer, smart2]
  };

  const folder = createMockFolder("Dest");
  const psbDoc = { id: 500, name: "temp.psb", saveAs: { jpg: async () => {} } };

  const app = {
    activeDocument: mainDoc,
    documents: [mainDoc]
  };

  const result = await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, textLayer, smart2],
    getAllLayers: () => [smart1, textLayer, smart2],
    selectFolder: async () => folder,
    openSmartObject: async layer => {
      processedLayerIds.push(layer.id);
      app.documents.push(psbDoc);
      app.activeDocument = psbDoc;
    },
    closeSmartObject: async doc => {
      app.documents = app.documents.filter(d => d.id !== doc.id);
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.successCount, 2);
  assert.equal(result.destinationFolder, folder);
  assert.deepEqual(processedLayerIds, [101, 102], "text layer 201 must be skipped");
});

// ==========================================
// DEVICE VALUE HELPERS
// ==========================================

test("Device helpers: normalizeDeviceType & isValidDeviceType", () => {
  assert.equal(normalizeDeviceType("LT"), "LT");
  assert.equal(normalizeDeviceType("lt"), "LT");
  assert.equal(normalizeDeviceType("DT"), "DT");
  assert.equal(normalizeDeviceType("dt"), "DT");
  assert.equal(normalizeDeviceType(" desktop "), null);
  assert.equal(normalizeDeviceType(""), null);
  assert.equal(normalizeDeviceType(null), null);
  assert.equal(normalizeDeviceType(undefined), null);

  assert.equal(isValidDeviceType("LT"), true);
  assert.equal(isValidDeviceType("DT"), true);
  assert.equal(isValidDeviceType("lt"), true);
  assert.equal(isValidDeviceType("dt"), true);
  assert.equal(isValidDeviceType("PC"), false);
  assert.equal(isValidDeviceType(""), false);
});

test("Device helpers: getStoredDeviceType & saveDeviceType with storage", () => {
  const storage = createMockStorage();
  assert.equal(getStoredDeviceType(storage), null);

  saveDeviceType(storage, "lt");
  assert.equal(storage.getItem(DEVICE_STORAGE_KEY), "LT");
  assert.equal(getStoredDeviceType(storage), "LT");

  saveDeviceType(storage, "DT");
  assert.equal(storage.getItem(DEVICE_STORAGE_KEY), "DT");
  assert.equal(getStoredDeviceType(storage), "DT");

  // Invalid save should not corrupt
  saveDeviceType(storage, "invalid");
  assert.equal(getStoredDeviceType(storage), "DT");
});

test("8 & 9. buildEditedPhotoFileName(number, deviceType)", () => {
  assert.equal(buildEditedPhotoFileName(1, "LT"), "FM1 LT.jpg");
  assert.equal(buildEditedPhotoFileName(1, "DT"), "FM1 DT.jpg");
  assert.equal(buildEditedPhotoFileName(12, "DT"), "FM12 DT.jpg");
  assert.equal(buildEditedPhotoFileName(5, "lt"), "FM5 LT.jpg");
  assert.equal(buildEditedPhotoFileName(7, "dt"), "FM7 DT.jpg");

  assert.throws(() => buildEditedPhotoFileName(1, "OTHER"), /Invalid device type/);
});

// ==========================================
// 10-16: NUMBER REGEX & FIRST FREE NUMBER (SHARED LT & DT)
// ==========================================

test("10, 11, 12. Regex recognizes LT and DT case-insensitively and with jpeg extensions", () => {
  assert.equal(extractEditedPhotoNumber("FM1 LT.jpg"), 1);
  assert.equal(extractEditedPhotoNumber("FM2 DT.jpg"), 2);
  assert.equal(extractEditedPhotoNumber("FM5 lt.JPG"), 5);
  assert.equal(extractEditedPhotoNumber("FM7 dt.jpeg"), 7);
  assert.equal(extractEditedPhotoNumber("FM12 DT.JPEG"), 12);

  assert.equal(extractEditedPhotoNumber("FM ABC LT.jpg"), null);
  assert.equal(extractEditedPhotoNumber("Other 1 LT.jpg"), null);
  assert.equal(extractEditedPhotoNumber("FM1 OTHER.jpg"), null);
  assert.equal(extractEditedPhotoNumber("Memory Maker 1 LT.jpg"), null, "legacy Memory Maker filename is ignored");
});

test("11. findNextEditedPhotoNumber([]) -> 1", () => {
  assert.equal(findNextEditedPhotoNumber([]), 1);
  assert.equal(findNextEditedPhotoNumber(null), 1);
});

test("13. Existing [1 LT, 3 DT] -> next number 2 (gap filled)", () => {
  assert.equal(findNextEditedPhotoNumber(["FM1 LT.jpg", "FM3 DT.jpg"]), 2);
});

test("14. Existing [1 DT, 2 LT, 3 DT] -> next number 4", () => {
  assert.equal(findNextEditedPhotoNumber([
    "FM1 DT.jpg",
    "FM2 LT.jpg",
    "FM3 DT.jpg"
  ]), 4);
});

test("15. Unrelated files ignored by findNextEditedPhotoNumber", () => {
  assert.equal(findNextEditedPhotoNumber([
    "FM ABC LT.jpg",
    "Other 1 LT.jpg",
    "photo.png",
    "FM1 LT.psd",
    "Memory Maker 1 LT.jpg"
  ]), 1);
});

test("17. Global shared numbering: LT and DT do NOT maintain separate sequences", () => {
  // If destination has 1 LT, 2 LT, 3 DT:
  // Next number is 4, regardless of whether current device is LT or DT
  assert.equal(findNextEditedPhotoNumber([
    "FM1 LT.jpg",
    "FM2 LT.jpg",
    "FM3 DT.jpg"
  ]), 4);

  // If destination has 1 DT, 3 LT:
  // Next number is 2 (fills gap)
  assert.equal(findNextEditedPhotoNumber([
    "FM1 DT.jpg",
    "FM3 LT.jpg"
  ]), 2);
});

// ==========================================
// MULTIPLE EXPORT NAMES ACROSS LT & DT
// ==========================================

test("15. Current device DT + existing [1 LT, 3 DT] with 3 exports produce 2 DT, 4 DT, 5 DT", async () => {
  const folder = createMockFolder("Folder", ["FM1 LT.jpg", "FM3 DT.jpg"]);
  const storage = createMockStorage({ [DEVICE_STORAGE_KEY]: "DT" });

  const smart1 = { id: 101, kind: "smartObject", name: "SO 1" };
  const smart2 = { id: 102, kind: "smartObject", name: "SO 2" };
  const smart3 = { id: 103, kind: "smartObject", name: "SO 3" };

  const mainDoc = {
    id: 10,
    name: "Album.psd",
    layers: [smart1, smart2, smart3]
  };

  const psbDoc = { id: 501, name: "temp.psb" };
  const app = {
    activeDocument: mainDoc,
    documents: [mainDoc]
  };

  const createdFileNames = [];

  const result = await executeSaveEditedPhotos({
    app,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, smart2, smart3],
    getAllLayers: () => [smart1, smart2, smart3],
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psbDoc);
      app.activeDocument = psbDoc;
    },
    closeSmartObject: async doc => {
      app.documents = app.documents.filter(d => d.id !== doc.id);
      app.activeDocument = mainDoc;
    },
    saveJpeg: async (doc, fileEntry) => {
      createdFileNames.push(fileEntry.name);
    }
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.successCount, 3);
  assert.deepEqual(createdFileNames, [
    "FM2 DT.jpg",
    "FM4 DT.jpg",
    "FM5 DT.jpg"
  ]);
});

test("16. Current device LT with same setup produces 2 LT, 4 LT, 5 LT", async () => {
  const folder = createMockFolder("Folder", ["FM1 LT.jpg", "FM3 DT.jpg"]);
  const storage = createMockStorage({ [DEVICE_STORAGE_KEY]: "LT" });

  const smart1 = { id: 101, kind: "smartObject", name: "SO 1" };
  const smart2 = { id: 102, kind: "smartObject", name: "SO 2" };
  const smart3 = { id: 103, kind: "smartObject", name: "SO 3" };

  const mainDoc = {
    id: 10,
    name: "Album.psd",
    layers: [smart1, smart2, smart3]
  };

  const psbDoc = { id: 501, name: "temp.psb" };
  const app = {
    activeDocument: mainDoc,
    documents: [mainDoc]
  };

  const createdFileNames = [];

  const result = await executeSaveEditedPhotos({
    app,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, smart2, smart3],
    getAllLayers: () => [smart1, smart2, smart3],
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psbDoc);
      app.activeDocument = psbDoc;
    },
    closeSmartObject: async doc => {
      app.documents = app.documents.filter(d => d.id !== doc.id);
      app.activeDocument = mainDoc;
    },
    saveJpeg: async (doc, fileEntry) => {
      createdFileNames.push(fileEntry.name);
    }
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.successCount, 3);
  assert.deepEqual(createdFileNames, [
    "FM2 LT.jpg",
    "FM4 LT.jpg",
    "FM5 LT.jpg"
  ]);
});

// ==========================================
// FIRST-RUN DEVICE CHOICE & STORAGE
// ==========================================

test("1 & 5. First run with no stored device type opens dialog and persists Laptop (LT)", async () => {
  const storage = createMockStorage();
  const folder = createMockFolder("Dest");
  const smart = { id: 101, kind: "smartObject", name: "SO" };
  const mainDoc = { id: 1, name: "Album.psd", layers: [smart] };
  const psb = { id: 99, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  let dialogPromptCalled = false;
  const createdFileNames = [];

  const result = await executeSaveEditedPhotos({
    app,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    promptForDeviceType: async () => {
      dialogPromptCalled = true;
      return { cancelled: false, deviceType: "LT" };
    },
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async (doc, entry) => {
      createdFileNames.push(entry.name);
    }
  });

  assert.equal(dialogPromptCalled, true, "dialog must open when no device type is stored");
  assert.equal(storage.getItem(DEVICE_STORAGE_KEY), "LT", "Laptop selection must persist LT");
  assert.equal(result.outcome, "success");
  assert.deepEqual(createdFileNames, ["FM1 LT.jpg"]);
});

test("6. Desktop selection persists DT and exports FM1 DT.jpg", async () => {
  const storage = createMockStorage();
  const folder = createMockFolder("Dest");
  const smart = { id: 101, kind: "smartObject", name: "SO" };
  const mainDoc = { id: 1, name: "Album.psd", layers: [smart] };
  const psb = { id: 99, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  let dialogPromptCalled = false;
  const createdFileNames = [];

  const result = await executeSaveEditedPhotos({
    app,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    promptForDeviceType: async () => {
      dialogPromptCalled = true;
      return { cancelled: false, deviceType: "DT" };
    },
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async (doc, entry) => {
      createdFileNames.push(entry.name);
    }
  });

  assert.equal(dialogPromptCalled, true);
  assert.equal(storage.getItem(DEVICE_STORAGE_KEY), "DT", "Desktop selection must persist DT");
  assert.equal(result.outcome, "success");
  assert.deepEqual(createdFileNames, ["FM1 DT.jpg"]);
});

test("2 & 3. Stored LT or DT: dialog does not open on subsequent runs", async () => {
  const storage = createMockStorage({ [DEVICE_STORAGE_KEY]: "LT" });
  const folder = createMockFolder("Dest");
  const smart = { id: 101, kind: "smartObject", name: "SO" };
  const mainDoc = { id: 1, name: "Album.psd", layers: [smart] };
  const psb = { id: 99, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  let dialogPromptCalled = false;

  await executeSaveEditedPhotos({
    app,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    promptForDeviceType: async () => {
      dialogPromptCalled = true;
      return { cancelled: false, deviceType: "LT" };
    },
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(dialogPromptCalled, false, "dialog must NOT open when device type is already stored");
});

test("4. Invalid stored value triggers device dialog", async () => {
  const storage = createMockStorage({ [DEVICE_STORAGE_KEY]: "invalid-device" });
  const folder = createMockFolder("Dest");
  const smart = { id: 101, kind: "smartObject", name: "SO" };
  const mainDoc = { id: 1, name: "Album.psd", layers: [smart] };
  const psb = { id: 99, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  let dialogPromptCalled = false;

  await executeSaveEditedPhotos({
    app,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    promptForDeviceType: async () => {
      dialogPromptCalled = true;
      return { cancelled: false, deviceType: "DT" };
    },
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(dialogPromptCalled, true, "dialog MUST open when stored device is invalid");
  assert.equal(storage.getItem(DEVICE_STORAGE_KEY), "DT");
});

test("7. Cancel device dialog: no folder picker, no export, no device saved", async () => {
  const storage = createMockStorage();
  let folderPickerCalled = false;
  let exportCalled = false;

  const smart = { id: 101, kind: "smartObject", name: "SO" };
  const mainDoc = { id: 1, name: "Album.psd", layers: [smart] };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  const result = await executeSaveEditedPhotos({
    app,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    promptForDeviceType: async () => ({ cancelled: true }),
    selectFolder: async () => {
      folderPickerCalled = true;
      return createMockFolder("Dest");
    },
    openSmartObject: async () => { exportCalled = true; },
    closeSmartObject: async () => {},
    saveJpeg: async () => { exportCalled = true; }
  });

  assert.equal(result.outcome, "cancelled");
  assert.equal(folderPickerCalled, false, "folder picker must not be called when device dialog is cancelled");
  assert.equal(exportCalled, false, "no exports when device dialog is cancelled");
  assert.equal(storage.getItem(DEVICE_STORAGE_KEY), null, "device type must not be saved on cancel");

  const toast = buildSaveEditedPhotosToast(result);
  assert.equal(toast.message, "Cancelled");
  assert.equal(toast.type, "info");
});

// ==========================================
// 17-21: FOLDER MEMORY
// ==========================================

test("17. Chosen folder token is persisted to storage", async () => {
  const storage = createMockStorage();
  const folder = createMockFolder("MyFolder");

  let persistentTokenCreated = false;
  const localFS = {
    async getFolder() { return folder; },
    async createPersistentToken() {
      persistentTokenCreated = true;
      return "token-12345";
    }
  };

  const smart = { id: 1, kind: "smartObject", name: "S" };
  const mainDoc = { id: 1, name: "Doc", layers: [smart] };
  const psb = { id: 2, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  await executeSaveEditedPhotos({
    app,
    localFileSystem: localFS,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(persistentTokenCreated, true);
  assert.equal(getStoredValue(FOLDER_TOKEN_KEY, storage), "token-12345");
});

test("18. Valid token is checked on subsequent run", async () => {
  const storage = createMockStorage({ [FOLDER_TOKEN_KEY]: "valid-token" });
  let tokenRetrieved = false;

  const localFS = {
    async getEntryForPersistentToken(tok) {
      if (tok === "valid-token") {
        tokenRetrieved = true;
        return createMockFolder("StoredFolder");
      }
      throw new Error("Invalid");
    },
    async getFolder() { return createMockFolder("Picked"); },
    async createPersistentToken() { return "new-token"; }
  };

  const smart = { id: 1, kind: "smartObject", name: "S" };
  const mainDoc = { id: 1, name: "Doc", layers: [smart] };
  const psb = { id: 2, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  const result = await executeSaveEditedPhotos({
    app,
    localFileSystem: localFS,
    storage,
    browseFolder: async ({ initialFolder }) => ({ folder: initialFolder }),
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(tokenRetrieved, true);
  assert.equal(result.outcome, "success");
});

test("19. Invalid token is cleared safely", async () => {
  const storage = createMockStorage({ [FOLDER_TOKEN_KEY]: "stale-deleted-token" });

  const localFS = {
    async getEntryForPersistentToken() {
      throw new Error("Folder no longer exists");
    },
    async getFolder() { return createMockFolder("Fresh"); },
    async createPersistentToken() { return "fresh-token"; }
  };

  const smart = { id: 1, kind: "smartObject", name: "S" };
  const mainDoc = { id: 1, name: "Doc", layers: [smart] };
  const psb = { id: 2, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };

  await executeSaveEditedPhotos({
    app,
    localFileSystem: localFS,
    storage,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(getStoredValue(FOLDER_TOKEN_KEY, storage), "fresh-token");
});

test("20 & 21. Folder cancel means zero exports, toast = Cancelled", async () => {
  let saveAttempted = false;
  const smart = { id: 1, kind: "smartObject", name: "S" };
  const mainDoc = { id: 1, name: "Doc", layers: [smart] };

  const result = await executeSaveEditedPhotos({
    app: { activeDocument: mainDoc, documents: [mainDoc] },
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    selectFolder: async () => null, // user cancels
    saveJpeg: async () => { saveAttempted = true; }
  });

  assert.equal(result.outcome, "cancelled");
  assert.equal(saveAttempted, false);
  const toast = buildSaveEditedPhotosToast(result);
  assert.equal(toast.message, "Cancelled");
});

// ==========================================
// 22-26: JPEG SAVE
// ==========================================

test("22-26. JPEG save uses opened Smart Object document, quality 12, exact filename, overwrite false, no flattening", async () => {
  let mainDocFlattened = false;
  const smart = { id: 1, kind: "smartObject", name: "Layer 1" };
  const mainDoc = {
    id: 10,
    name: "MainDoc.psd",
    layers: [smart],
    flatten() { mainDocFlattened = true; }
  };

  const psbDoc = { id: 99, name: "Layer 1.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");

  let savedDoc = null;
  let savedOpts = null;
  let savedEntry = null;

  const result = await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psbDoc);
      app.activeDocument = psbDoc;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async (doc, fileEntry, opts) => {
      savedDoc = doc;
      savedEntry = fileEntry;
      savedOpts = opts;
    }
  });

  assert.equal(result.outcome, "success");
  assert.equal(savedDoc.id, 99, "22. must save opened PSB document, not main document");
  assert.equal(savedOpts.quality, 12, "23. quality must be exactly 12");
  assert.equal(savedEntry.name, "FM1 LT.jpg", "24. target filename exact");
  assert.equal(mainDocFlattened, false, "26. source main document not flattened");
});

// ==========================================
// 27-31: SMART OBJECT OPEN / CLOSE
// ==========================================

test("27-31. placedLayerEditContents invoked, identified, closed without saving, main doc reactivated sequentially", async () => {
  const smart1 = { id: 101, kind: "smartObject", name: "SO1" };
  const smart2 = { id: 102, kind: "smartObject", name: "SO2" };
  const mainDoc = { id: 1, name: "Main.psd", layers: [smart1, smart2] };

  const callLog = [];
  const psb1 = { id: 201, name: "SO1.psb" };
  const psb2 = { id: 202, name: "SO2.psb" };

  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");

  const result = await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, smart2],
    getAllLayers: () => [smart1, smart2],
    selectFolder: async () => folder,
    openSmartObject: async layer => {
      callLog.push(`open:${layer.id}`);
      const psb = layer.id === 101 ? psb1 : psb2;
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async doc => {
      callLog.push(`close:${doc.id}`);
      app.documents = app.documents.filter(d => d.id !== doc.id);
      app.activeDocument = mainDoc;
    },
    saveJpeg: async (doc, entry) => {
      callLog.push(`save:${doc.id}:${entry.name}`);
    }
  });

  assert.equal(result.outcome, "success");
  assert.deepEqual(callLog, [
    "open:101", "save:201:FM1 LT.jpg", "close:201",
    "open:102", "save:202:FM2 LT.jpg", "close:202"
  ]);
  assert.equal(app.activeDocument.id, 1, "main document must be active at the end");
});

// ==========================================
// 32-35: ERROR CLEANUP
// ==========================================

test("32-35. JPEG failure after Smart Object open: PSB document closes without saving, later layer still succeeds", async () => {
  const smart1 = { id: 101, kind: "smartObject", name: "FailingSO" };
  const smart2 = { id: 102, kind: "smartObject", name: "WorkingSO" };
  const mainDoc = { id: 1, name: "Main.psd", layers: [smart1, smart2] };

  const psb1 = { id: 201, name: "Failing.psb" };
  const psb2 = { id: 202, name: "Working.psb" };

  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");
  const closedDocs = [];

  const result = await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, smart2],
    getAllLayers: () => [smart1, smart2],
    selectFolder: async () => folder,
    openSmartObject: async layer => {
      const psb = layer.id === 101 ? psb1 : psb2;
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async doc => {
      closedDocs.push(doc.id);
      app.documents = app.documents.filter(d => d.id !== doc.id);
      app.activeDocument = mainDoc;
    },
    saveJpeg: async doc => {
      if (doc.id === 201) {
        throw new Error("JPEG disk error");
      }
    }
  });

  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.destinationFolder, folder);
  assert.equal(result.firstFailureError?.message, "JPEG disk error");
  assert.deepEqual(closedDocs, [201, 202], "32. failing PSB 201 must still be closed");
  assert.equal(app.documents.length, 1, "35. no orphan PSB left open");

  const toast = buildSaveEditedPhotosToast(result);
  assert.equal(toast.message, "1 saved • 1 failed");
  assert.equal(toast.type, "warning");
});

// ==========================================
// 36-38: DOCUMENT / LAYER ID SAFETY
// ==========================================

test("36. User switches document during folder picker: original main doc still processed by ID", async () => {
  const smart = { id: 101, kind: "smartObject", name: "SO" };
  const mainDocA = { id: 11, name: "DocA.psd", layers: [smart] };
  const otherDocB = { id: 22, name: "DocB.psd", layers: [] };

  const app = { activeDocument: mainDocA, documents: [mainDocA, otherDocB] };
  const folder = createMockFolder("Dest");
  const psb = { id: 99, name: "temp.psb" };

  let resolvedDocId = null;

  const result = await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDocA,
    getSelectedLayers: () => [smart],
    getAllLayers: doc => {
      resolvedDocId = doc.id;
      return doc.layers;
    },
    findDocById: (id, psApp) => psApp.documents.find(d => d.id === id),
    selectFolder: async () => {
      // User activates other doc B during folder picker
      app.activeDocument = otherDocB;
      return folder;
    },
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = app.documents.filter(d => d.id !== 99);
      app.activeDocument = mainDocA;
    },
    saveJpeg: async () => {}
  });

  assert.equal(result.outcome, "success");
  assert.equal(resolvedDocId, 11, "must process original doc A by ID, not doc B");
});

test("37. Original main document closed mid-workflow: abort safely with Document is no longer open", async () => {
  const smart1 = { id: 101, kind: "smartObject", name: "SO 1" };
  const smart2 = { id: 102, kind: "smartObject", name: "SO 2" };
  const mainDoc = { id: 55, name: "Album.psd", layers: [smart1, smart2] };

  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");
  const psb = { id: 99, name: "temp.psb" };

  let layerCount = 0;

  const result = await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, smart2],
    getAllLayers: doc => doc.layers,
    findDocById: (id, psApp) => psApp.documents.find(d => d.id === id),
    selectFolder: async () => folder,
    openSmartObject: async () => {
      layerCount++;
      if (layerCount === 2) {
        // User closes mainDoc before layer 2
        app.documents = [];
        app.activeDocument = null;
      } else {
        app.documents.push(psb);
        app.activeDocument = psb;
      }
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(result.outcome, "document-closed");
  const toast = buildSaveEditedPhotosToast(result);
  assert.equal(toast.message, "Document is no longer open");
});

test("38. Target layer deleted before its turn: skips safely and continues remaining layers", async () => {
  const smart1 = { id: 101, kind: "smartObject", name: "DeletedSO" };
  const smart2 = { id: 102, kind: "smartObject", name: "ValidSO" };

  // mainDoc only has smart2 (smart1 was deleted)
  const mainDoc = { id: 1, name: "Main.psd", layers: [smart2] };
  const psb = { id: 99, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");

  const result = await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, smart2],
    getAllLayers: () => [smart2],
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {}
  });

  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 1);
});

// ==========================================
// 39-43: SELECTION RESTORATION
// ==========================================

test("39-43. Original selected layer IDs restored after success and partial failure in cleanup", async () => {
  const smart1 = { id: 101, kind: "smartObject", name: "SO 1" };
  const smart2 = { id: 102, kind: "smartObject", name: "SO 2" };
  const text3 = { id: 103, kind: "text", name: "Text 3" };

  const mainDoc = {
    id: 1,
    name: "Doc.psd",
    layers: [smart1, smart2, text3]
  };

  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");
  const psb = { id: 99, name: "temp.psb" };

  let restoredIds = null;

  await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, text3, smart2],
    getAllLayers: () => [smart1, smart2, text3],
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {},
    selectLayers: async ids => {
      restoredIds = ids;
    }
  });

  assert.deepEqual(restoredIds, [101, 103, 102], "original selected layer IDs including text layer must be restored");
});

test("42. Missing/deleted original layer IDs do not crash selection restoration", async () => {
  const smart1 = { id: 101, kind: "smartObject", name: "SO 1" };
  const mainDoc = { id: 1, name: "Doc.psd", layers: [smart1] };

  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");
  const psb = { id: 99, name: "temp.psb" };

  let restoredIds = null;

  await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart1, { id: 999, name: "Deleted" }],
    getAllLayers: () => [smart1],
    selectFolder: async () => folder,
    openSmartObject: async () => {
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    closeSmartObject: async () => {
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    saveJpeg: async () => {},
    selectLayers: async ids => {
      restoredIds = ids;
    }
  });

  assert.deepEqual(restoredIds, [101], "restores only existing layer IDs without error");
});

// ==========================================
// 44-49: MODAL SCOPE
// ==========================================

test("44-49. Modal boundaries: folder picker outside modal, layer and file actions inside modal", async () => {
  let inModal = false;
  let pickerInModal = true;
  let openInModal = false;
  let saveInModal = false;
  let closeInModal = false;
  let restoreInModal = false;

  const smart = { id: 101, kind: "smartObject", name: "SO" };
  const mainDoc = { id: 1, name: "Doc.psd", layers: [smart] };
  const psb = { id: 99, name: "temp.psb" };
  const app = { activeDocument: mainDoc, documents: [mainDoc] };
  const folder = createMockFolder("Dest");

  await executeSaveEditedPhotos({
    app,
    getActiveDocument: () => mainDoc,
    getSelectedLayers: () => [smart],
    getAllLayers: () => [smart],
    executeModal: async (fn, cmd) => {
      inModal = true;
      try {
        return await fn();
      } finally {
        inModal = false;
      }
    },
    selectFolder: async () => {
      pickerInModal = inModal;
      return folder;
    },
    openSmartObject: async () => {
      openInModal = inModal;
      app.documents.push(psb);
      app.activeDocument = psb;
    },
    saveJpeg: async () => {
      saveInModal = inModal;
    },
    closeSmartObject: async () => {
      closeInModal = inModal;
      app.documents = [mainDoc];
      app.activeDocument = mainDoc;
    },
    selectLayers: async () => {
      restoreInModal = inModal;
    }
  });

  assert.equal(pickerInModal, false, "44. folder picker must occur OUTSIDE executeAsModal");
  assert.equal(openInModal, true, "46. placedLayerEditContents inside executeAsModal");
  assert.equal(saveInModal, true, "47. JPEG save inside executeAsModal");
  assert.equal(closeInModal, true, "48. Smart Object close inside executeAsModal");
  assert.equal(restoreInModal, true, "49. layer reselection inside executeAsModal");
});

// ==========================================
// BUTTON LOCKING (main.js integration)
// ==========================================

test("Button locking: all 5 buttons locked during execution and unlocked in finally", async () => {
  const h = createMainHarness();
  const saveEditedBtn = h.elements.get("saveEditedPhotosBtn");
  const savePageBtn = h.elements.get("savePageBtn");
  const openPsdBtn = h.elements.get("openPsdBtn");

  const promise = h.sandbox.handleSaveEditedPhotos();
  assert.equal(saveEditedBtn.disabled, true);
  assert.equal(savePageBtn.disabled, true);
  assert.equal(openPsdBtn.disabled, true);

  await promise;
  assert.equal(saveEditedBtn.disabled, false);
  assert.equal(savePageBtn.disabled, false);
  assert.equal(openPsdBtn.disabled, false);
});
