"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CATEGORIES,
  BASE_FOLDER_TOKEN_KEY,
  DEVICE_STORAGE_KEY,
  DELETE_ORIGINAL_STORAGE_KEY,
  cleanCategoryName,
  sanitizeCustomName,
  normalizeDeviceName,
  detectAutoCategory,
  pad2,
  buildOrientationString,
  buildSavePsdCategoryFileName,
  buildCategorySequenceRegex,
  getNextCategorySequenceNumber,
  detectLayerOrientations,
  buildSavePsdCategoryToast,
  getOrCreateSubfolder,
  resolveCollisionFreeCandidate,
  executeSavePsdCategory
} = require("../src/tools/savePsdCategory");

function createMockFolder(name = "CategoryBase") {
  const entries = new Map();
  return {
    name,
    isFolder: true,
    isFile: false,
    _entries: entries,
    async getEntry(entryName) {
      if (entries.has(entryName)) return entries.get(entryName);
      const err = new Error(`Entry "${entryName}" not found`);
      err.code = "ENOENT";
      throw err;
    },
    async getEntries() {
      return Array.from(entries.values());
    },
    async createFolder(subName) {
      if (entries.has(subName)) return entries.get(subName);
      const sub = createMockFolder(subName);
      entries.set(subName, sub);
      return sub;
    },
    async createFile(fileName, options = {}) {
      if (options.overwrite === false && entries.has(fileName)) {
        const err = new Error(`File "${fileName}" already exists`);
        err.code = "EEXIST";
        throw err;
      }
      const file = {
        name: fileName,
        isFile: true,
        isFolder: false,
        nativePath: `F:\\Mock\\${name}\\${fileName}`,
        deleted: false,
        async delete() {
          this.deleted = true;
          entries.delete(fileName);
        }
      };
      entries.set(fileName, file);
      return file;
    }
  };
}

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: key => map.delete(key),
    clear: () => map.clear(),
    _store: map
  };
}

function createMockFileSystem() {
  const store = new Map();
  let counter = 1;
  return {
    async createPersistentToken(entry) {
      const token = `tok-${counter++}-${entry.name}`;
      store.set(token, entry);
      return token;
    },
    async getEntryForPersistentToken(token) {
      if (store.has(token)) return store.get(token);
      throw new Error("Token invalid");
    },
    async getFolder() {
      return createMockFolder("NewBaseFolder");
    },
    async getNativePath(entry) {
      return `F:\\Mock\\${entry.name}`;
    }
  };
}

// 1. no active document
test("1. No active document: returns outcome no-document and warning toast", async () => {
  const result = await executeSavePsdCategory({
    getActiveDocument: () => null
  });
  assert.equal(result.outcome, "no-document");
  const toast = buildSavePsdCategoryToast(result);
  assert.equal(toast.message, "Open PSD first");
  assert.equal(toast.type, "warning");
});

// 2. no selected layers
test("2. No selected layers: returns outcome no-selected-layers and warning toast", async () => {
  const doc = { id: 101, name: "Sample.psd", activeLayers: [] };
  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => []
  });
  assert.equal(result.outcome, "no-selected-layers");
  const toast = buildSavePsdCategoryToast(result);
  assert.equal(toast.message, "Select placeholder layers!");
  assert.equal(toast.type, "warning");
});

// 3. exact category list
test("3. Exact category list matches legacy specifications", () => {
  assert.deepEqual(CATEGORIES, [
    "3 PHOTOS PSD",
    "4 PHOTOS PSD",
    "5 PHOTOS PSD",
    "6 PHOTOS PSD",
    "7 PHOTOS PSD",
    "8 PHOTOS PSD",
    "9 PHOTOS PSD",
    "10 PHOTOS PSD",
    "11 PHOTOS PSD",
    "12 PHOTOS PSD",
    "INSTA POST",
    "RICE CEREMONY"
  ]);
});

// 4. 3 selected -> 3 PHOTOS PSD
test("4. 3 selected layers auto-selects 3 PHOTOS PSD", () => {
  assert.equal(detectAutoCategory(3), "3 PHOTOS PSD");
});

// 5. 12 selected -> 12 PHOTOS PSD
test("5. 12 selected layers auto-selects 12 PHOTOS PSD", () => {
  assert.equal(detectAutoCategory(12), "12 PHOTOS PSD");
});

// 6. unmatched selected count -> first category
test("6. Unmatched selected count (< 3 or > 12) defaults to first category", () => {
  assert.equal(detectAutoCategory(2), "3 PHOTOS PSD");
  assert.equal(detectAutoCategory(13), "3 PHOTOS PSD");
  assert.equal(detectAutoCategory(0), "3 PHOTOS PSD");
});

// 7. custom category change allowed
test("7. Custom category change allowed via prompt", async () => {
  const baseFolder = createMockFolder();
  const doc = { id: 1, name: "Sample.psd" };
  const layers = [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }];

  let savedFile = null;
  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => layers,
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({
      category: "INSTA POST",
      customName: "",
      deleteOriginal: false
    }),
    saveDocumentCopy: async (d, file) => { savedFile = file; }
  });

  assert.equal(result.outcome, "success");
  assert.ok(result.fileName.includes("MMR INSTA POST"));
});

// 8. custom name whitespace normalization
test("8. Custom name whitespace normalization collapses spaces and trims", () => {
  assert.equal(sanitizeCustomName("  Bride   Wedding   "), "Bride Wedding");
  assert.equal(sanitizeCustomName("   "), "");
  assert.equal(sanitizeCustomName(null), "");
});

// 9. invalid filename character handling
test("9. Invalid filename characters are stripped from custom name", () => {
  assert.equal(sanitizeCustomName('Bride: "Wedding" <Special>? /\\|*'), "Bride Wedding Special");
});

// 10. LT device
test("10. LT device normalization", () => {
  assert.equal(normalizeDeviceName("LT"), "LT");
  assert.equal(normalizeDeviceName("LT (Laptop)"), "LT");
  assert.equal(normalizeDeviceName("lt"), "LT");
});

// 11. PC device
test("11. PC device normalization", () => {
  assert.equal(normalizeDeviceName("PC"), "PC");
  assert.equal(normalizeDeviceName("PC (Desktop)"), "PC");
  assert.equal(normalizeDeviceName("pc"), "PC");
});

// 12. custom device
test("12. Custom device name is cleaned and uppercased", () => {
  assert.equal(normalizeDeviceName("Studio 1"), "STUDIO1");
  assert.equal(normalizeDeviceName("  custom  "), "CUSTOM");
  assert.equal(normalizeDeviceName("   "), "CUSTOM");
});

// 13. device memory
test("13. Device name is persisted independently under its own key", async () => {
  const storage = createMockStorage();
  const baseFolder = createMockFolder();
  const doc = { id: 1, name: "Sample.psd" };
  const layers = [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }];

  await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => layers,
    selectFolder: async () => baseFolder,
    storage,
    promptForDeviceName: async () => ({ deviceName: "PC (Desktop)" }),
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: false }),
    saveDocumentCopy: async () => {}
  });

  assert.equal(storage.getItem(DEVICE_STORAGE_KEY), "PC");
});

// 14. delete preference memory
test("14. Delete preference memory stores checkbox state", async () => {
  const storage = createMockStorage();
  const baseFolder = createMockFolder();
  const doc = { id: 1, name: "Sample.psd" };
  const layers = [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }];

  await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => layers,
    selectFolder: async () => baseFolder,
    storage,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: false }),
    saveDocumentCopy: async () => {}
  });

  assert.equal(storage.getItem(DELETE_ORIGINAL_STORAGE_KEY), "true");
});

// 15. orientation landscape
test("15. Orientation landscape: width > height", () => {
  const layers = [{ bounds: { left: 0, top: 0, right: 1200, bottom: 800 } }];
  const detected = detectLayerOrientations(layers);
  assert.equal(detected.landscapeCount, 1);
  assert.equal(detected.portraitCount, 0);
  assert.equal(detected.squareCount, 0);
});

// 16. orientation portrait
test("16. Orientation portrait: height > width", () => {
  const layers = [{ bounds: { left: 0, top: 0, right: 800, bottom: 1200 } }];
  const detected = detectLayerOrientations(layers);
  assert.equal(detected.landscapeCount, 0);
  assert.equal(detected.portraitCount, 1);
  assert.equal(detected.squareCount, 0);
});

// 17. orientation square
test("17. Orientation square: width === height", () => {
  const layers = [{ bounds: { left: 0, top: 0, right: 1000, bottom: 1000 } }];
  const detected = detectLayerOrientations(layers);
  assert.equal(detected.landscapeCount, 0);
  assert.equal(detected.portraitCount, 0);
  assert.equal(detected.squareCount, 1);
});

// 18. orientation order L/P/S
test("18. Orientation string constructed in exact order L, P, S", () => {
  assert.equal(buildOrientationString(3, 0, 0), "3L");
  assert.equal(buildOrientationString(2, 1, 0), "2L_1P");
  assert.equal(buildOrientationString(0, 4, 1), "4P_1S");
  assert.equal(buildOrientationString(1, 2, 1), "1L_2P_1S");
  assert.equal(buildOrientationString(0, 0, 0), "");
});

// 19. manual orientation correction
test("19. Manual orientation correction overrides detected counts", async () => {
  const baseFolder = createMockFolder();
  const doc = { id: 1, name: "Sample.psd" };
  const layers = [
    { id: 10, bounds: { left: 0, top: 0, right: 1200, bottom: 800 } }, // 1L
    { id: 11, bounds: { left: 0, top: 0, right: 800, bottom: 1200 } }  // 1P
  ];

  let savedName = "";
  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => layers,
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: false }),
    promptForOrientationCheck: async () => ({
      landscapeCount: 3,
      portraitCount: 0,
      squareCount: 1
    }),
    saveDocumentCopy: async (d, file) => { savedName = file.name; }
  });

  assert.equal(result.outcome, "success");
  assert.ok(result.fileName.startsWith("3L_1S_MMR 3 PHOTOS"));
});

// 20. orientation cancel
test("20. Orientation dialog cancel aborts without saving", async () => {
  const baseFolder = createMockFolder();
  const doc = { id: 1, name: "Sample.psd" };
  let saveCalled = false;

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 1 }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: false }),
    promptForOrientationCheck: async () => ({ cancelled: true }),
    saveDocumentCopy: async () => { saveCalled = true; }
  });

  assert.equal(result.outcome, "cancelled");
  assert.equal(saveCalled, false);
});

// 21. category subfolder creation
test("21. Category subfolder is created inside base folder", async () => {
  const baseFolder = createMockFolder();
  const sub = await getOrCreateSubfolder(baseFolder, "3 PHOTOS PSD");
  assert.equal(sub.name, "3 PHOTOS PSD");
  assert.ok(baseFolder._entries.has("3 PHOTOS PSD"));
});

// 22. existing subfolder reuse
test("22. Existing subfolder is reused without duplication", async () => {
  const baseFolder = createMockFolder();
  const sub1 = await getOrCreateSubfolder(baseFolder, "INSTA POST");
  const sub2 = await getOrCreateSubfolder(baseFolder, "INSTA POST");
  assert.equal(sub1, sub2);
});

// 23. clean " PSD" removal
test("23. cleanCategoryName removes trailing ' PSD'", () => {
  assert.equal(cleanCategoryName("3 PHOTOS PSD"), "3 PHOTOS");
  assert.equal(cleanCategoryName("12 PHOTOS PSD"), "12 PHOTOS");
  assert.equal(cleanCategoryName("INSTA POST"), "INSTA POST");
  assert.equal(cleanCategoryName("RICE CEREMONY"), "RICE CEREMONY");
});

// 24. max+1 numbering
test("24. Max+1 numbering starts at 01 when folder is empty", () => {
  const next = getNextCategorySequenceNumber([], "3 PHOTOS");
  assert.equal(next, 1);
  assert.equal(pad2(next), "01");
});

// 25. regex recognizes generated device suffix
test("25. Regex recognizes generated filename with device suffix", () => {
  const existing = ["MMR 3 PHOTOS 01 PC.psd", "MMR 3 PHOTOS 02 LT.psd"];
  const next = getNextCategorySequenceNumber(existing, "3 PHOTOS");
  assert.equal(next, 3);
});

// 26. regex recognizes orientation prefix
test("26. Regex recognizes orientation prefix", () => {
  const existing = ["2L_1P_MMR 3 PHOTOS 01 LT.psd"];
  const next = getNextCategorySequenceNumber(existing, "3 PHOTOS");
  assert.equal(next, 2);
});

// 27. regex recognizes custom prefix
test("27. Regex recognizes custom prefix and mixed prefix", () => {
  const existing = [
    "Bride_MMR 5 PHOTOS 09 PC.psd",
    "2L_2P_Bride_MMR 4 PHOTOS 12 CUSTOM.psd"
  ];
  assert.equal(getNextCategorySequenceNumber(existing, "5 PHOTOS"), 10);
  assert.equal(getNextCategorySequenceNumber(existing, "4 PHOTOS"), 13);
  assert.equal(getNextCategorySequenceNumber(["Bride_MMR 4 PHOTOS 12 STUDIO.PC.psd"], "4 PHOTOS"), 13);
});

// 28. unrelated PSD ignored
test("28. Unrelated PSD files in category folder are ignored", () => {
  const existing = [
    "notes.psd",
    "cover.psd",
    "MMR 4 PHOTOS 05 PC.psd" // different category!
  ];
  const next = getNextCategorySequenceNumber(existing, "3 PHOTOS");
  assert.equal(next, 1);
});

// 29. exact collision increments
test("29. Collision avoidance increments sequence until free name found", async () => {
  const categoryFolder = createMockFolder("3 PHOTOS PSD");
  await categoryFolder.createFile("2L_1P_MMR 3 PHOTOS 01 PC.psd");

  const cand = await resolveCollisionFreeCandidate(categoryFolder, {
    orientationPart: "2L_1P",
    customName: "",
    cleanCategory: "3 PHOTOS",
    sequenceNumber: 1,
    deviceName: "PC"
  });

  assert.equal(cand.fileName, "2L_1P_MMR 3 PHOTOS 02 PC.psd");
});

// 30. PSD save preserves layers intent
test("30. PSD save uses embedColorProfile and does not flatten", async () => {
  const baseFolder = createMockFolder();
  const doc = { id: 1, name: "Sample.psd" };
  const layers = [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }];

  let saveOpts = null;
  await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => layers,
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: false }),
    saveDocumentCopy: async (d, file, opts) => {
      saveOpts = opts;
    }
  });

  assert.ok(saveOpts);
  assert.equal(saveOpts.embedColorProfile, true);
});

// 31. delete unchecked leaves original file
test("31. Delete unchecked leaves original file on disk and closes document", async () => {
  const baseFolder = createMockFolder();
  let originalFileDeleted = false;
  const originalFile = {
    name: "Original.psd",
    isFile: true,
    async delete() { originalFileDeleted = true; }
  };
  let docClosed = false;
  const doc = {
    id: 1,
    name: "Original.psd",
    _fileEntry: originalFile
  };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: false }),
    saveDocumentCopy: async () => {},
    closeDocWithoutSaving: async () => { docClosed = true; }
  });

  assert.equal(result.outcome, "success");
  assert.equal(originalFileDeleted, false, "Original file must NOT be deleted");
  assert.equal(docClosed, true, "Document must be closed without saving");
  const toast = buildSavePsdCategoryToast(result);
  assert.ok(toast.message.includes("PSD saved:"));
  assert.equal(toast.type, "success");
});

// 32. delete checked + confirmed deletes only original
test("32. Delete checked + confirmed deletes original file safely", async () => {
  const baseFolder = createMockFolder();
  let originalFileDeleted = false;
  const originalFile = {
    name: "Original.psd",
    isFile: true,
    nativePath: "F:\\Source\\Original.psd",
    async delete() { originalFileDeleted = true; }
  };
  const doc = {
    id: 1,
    name: "Original.psd",
    _fileEntry: originalFile
  };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: true }),
    saveDocumentCopy: async () => {},
    closeDocWithoutSaving: async () => {}
  });

  assert.equal(result.outcome, "saved-original-deleted");
  assert.equal(originalFileDeleted, true);
  const toast = buildSavePsdCategoryToast(result);
  assert.equal(toast.message, "Saved • original deleted");
  assert.equal(toast.type, "success");
});

// 33. delete confirmation cancelled keeps original
test("33. Delete confirmation cancelled keeps original file", async () => {
  const baseFolder = createMockFolder();
  let originalFileDeleted = false;
  const originalFile = {
    name: "Original.psd",
    isFile: true,
    async delete() { originalFileDeleted = true; }
  };
  const doc = {
    id: 1,
    name: "Original.psd",
    _fileEntry: originalFile
  };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: false, cancelled: true }),
    saveDocumentCopy: async () => {},
    closeDocWithoutSaving: async () => {}
  });

  assert.equal(result.outcome, "success-delete-cancelled");
  assert.equal(originalFileDeleted, false);
  const toast = buildSavePsdCategoryToast(result);
  assert.equal(toast.message, "Saved • delete cancelled");
  assert.equal(toast.type, "info");
});

// 34. failed save never deletes original
test("34. Failed PSD copy save NEVER attempts original deletion", async () => {
  const baseFolder = createMockFolder();
  let originalFileDeleted = false;
  const originalFile = {
    name: "Original.psd",
    isFile: true,
    async delete() { originalFileDeleted = true; }
  };
  const doc = {
    id: 1,
    name: "Original.psd",
    _fileEntry: originalFile
  };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: true }),
    saveDocumentCopy: async () => {
      throw new Error("Disk write error during save");
    },
    closeDocWithoutSaving: async () => {}
  });

  assert.equal(result.outcome, "psd-failed");
  assert.equal(originalFileDeleted, false, "Must never delete original if save failed");
});

// 35. source equals target guard
test("35. Source equals target guard prevents deleting the newly created category output", async () => {
  const baseFolder = createMockFolder();
  let fileDeleted = false;
  const targetName = "1L_MMR 3 PHOTOS 01 PC.psd";
  const originalFile = {
    name: targetName,
    nativePath: `F:\\Mock\\3 PHOTOS PSD\\${targetName}`,
    isFile: true,
    async delete() { fileDeleted = true; }
  };
  const doc = {
    id: 1,
    name: targetName,
    _fileEntry: originalFile
  };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: true }),
    saveDocumentCopy: async () => {},
    closeDocWithoutSaving: async () => {}
  });

  assert.equal(result.outcome, "saved-delete-failed");
  assert.equal(fileDeleted, false, "Must not delete file when source matches target");
});

// 36. unsaved document delete guard
test("36. Unsaved document (no original local file) delete guard", async () => {
  const baseFolder = createMockFolder();
  const doc = {
    id: 1,
    name: "Untitled-1" // No file entry
  };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: true }),
    saveDocumentCopy: async () => {},
    closeDocWithoutSaving: async () => {}
  });

  assert.equal(result.outcome, "saved-delete-failed");
});

// 37. delete failure preserves category output
test("37. Delete failure preserves category output and reports appropriate toast", async () => {
  const baseFolder = createMockFolder();
  const originalFile = {
    name: "Source.psd",
    isFile: true,
    nativePath: "F:\\Source\\Source.psd",
    async delete() { throw new Error("File locked by another process"); }
  };
  const doc = {
    id: 1,
    name: "Source.psd",
    _fileEntry: originalFile
  };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    selectFolder: async () => baseFolder,
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: true }),
    saveDocumentCopy: async () => {},
    closeDocWithoutSaving: async () => {}
  });

  assert.equal(result.outcome, "saved-delete-failed");
  const toast = buildSavePsdCategoryToast(result);
  assert.equal(toast.message, "Saved, but original delete failed");
  assert.equal(toast.type, "warning");
});

// 38. base folder token restored
test("38. Shift uses restored base folder without browser or picker", async () => {
  const fs = createMockFileSystem();
  const storage = createMockStorage();
  const savedFolder = createMockFolder("RestoredCategoryBase");
  const token = await fs.createPersistentToken(savedFolder);
  storage.setItem(BASE_FOLDER_TOKEN_KEY, token);

  const doc = { id: 1, name: "Sample.psd" };
  let pickerCalled = false;

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    localFileSystem: {
      ...fs,
      async getFolder() {
        pickerCalled = true;
        return createMockFolder("UnexpectedPickerFolder");
      }
    },
    storage,
    browseFolder: async () => { assert.fail("Folder browser must not open for Shift"); },
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: false }),
    saveDocumentCopy: async () => {}
  }, { useRememberedDirectly: true });

  assert.equal(result.outcome, "success");
  assert.equal(pickerCalled, false, "Shift must skip native getFolder()");
});

// 39. base folder CHANGE updates token
test("39. Normal browser confirms a new base folder and updates its token", async () => {
  const fs = createMockFileSystem();
  const storage = createMockStorage();
  const oldFolder = createMockFolder("OldBase");
  const oldToken = await fs.createPersistentToken(oldFolder);
  storage.setItem(BASE_FOLDER_TOKEN_KEY, oldToken);

  const newFolder = createMockFolder("NewBaseChosen");
  const doc = { id: 1, name: "Sample.psd" };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    localFileSystem: {
      ...fs,
      async getFolder() {
        assert.fail("Remembered folder must open custom browser");
      }
    },
    storage,
    browseFolder: async ({ initialFolder }) => { assert.equal(initialFolder, oldFolder); return { folder: newFolder }; },
    promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", customName: "", deleteOriginal: false }),
    saveDocumentCopy: async () => {}
  });

  assert.equal(result.outcome, "success");
  const currentToken = storage.getItem(BASE_FOLDER_TOKEN_KEY);
  assert.notEqual(currentToken, oldToken, "Token must be updated after CHANGE FOLDER");
});

// 40. base folder picker cancel preserves token
test("40. Base folder browser cancel preserves previous valid token", async () => {
  const fs = createMockFileSystem();
  const storage = createMockStorage();
  const oldFolder = createMockFolder("OldBase");
  const oldToken = await fs.createPersistentToken(oldFolder);
  storage.setItem(BASE_FOLDER_TOKEN_KEY, oldToken);

  const doc = { id: 1, name: "Sample.psd" };

  const result = await executeSavePsdCategory({
    getActiveDocument: () => doc,
    getSelectedLayers: () => [{ id: 10, bounds: { left: 0, top: 0, right: 100, bottom: 50 } }],
    localFileSystem: {
      ...fs,
      async getFolder() {
        return null; // User cancelled picker
      }
    },
    storage,
    browseFolder: async () => ({ cancelled: true }),
    saveDocumentCopy: async () => {}
  });

  assert.equal(result.outcome, "cancelled");
  assert.equal(storage.getItem(BASE_FOLDER_TOKEN_KEY), oldToken, "Old token must be preserved on cancel");
});
