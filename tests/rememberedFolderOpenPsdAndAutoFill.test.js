"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TOKEN_KEYS,
  restoreFolderFromToken,
  saveFolderToken,
  getParentFolder
} = require("../src/folderMemory");
const { executeOpenPsd, getDefaultDependencies } = require("../src/tools/openPsd");
const { executeAutoPhotoFill } = require("../src/tools/autoPhotoFill");
const { SUPPORTED_IMAGE_TYPES, selectImageFiles } = require("../src/files");

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
  const persistentStore = new Map();
  let tokenCounter = 1;

  return {
    async createPersistentToken(entry) {
      if (!entry) throw new Error("No entry");
      if (entry._failToken) throw new Error("Persistent token creation failed");
      const token = `token-${tokenCounter++}-${entry.name || "folder"}`;
      persistentStore.set(token, entry);
      return token;
    },
    async getEntryForPersistentToken(token) {
      if (persistentStore.has(token)) {
        const entry = persistentStore.get(token);
        if (entry._isStale) {
          throw new Error("Folder moved or inaccessible");
        }
        return entry;
      }
      const err = new Error("Token not found");
      err.code = "ENOENT";
      throw err;
    },
    async getNativePath(entry) {
      return entry.nativePath || `D:\\Mock\\${entry.name}`;
    },
    async getEntryWithUrl(url) {
      return {
        name: "ResolvedByUrl",
        isFolder: true,
        isFile: false,
        url
      };
    },
    _persistentStore: persistentStore
  };
}

function createMinimalPsdDeps(overrides = {}) {
  return {
    selectPsdFiles: async () => [],
    openDocument: async file => ({ id: 100, name: file.name, layers: [] }),
    ensureActiveDocument: () => {},
    setActiveDocument: () => {},
    executeModal: async fn => fn(),
    smartRenameLayers: () => {},
    getDocumentMetrics: async () => ({ pixelWidth: 10800, pixelHeight: 3600, resolution: 300, widthInches: 36, heightInches: 12 }),
    normalizeDocumentToPixels: async () => {},
    clearAllGuides: async () => {},
    addAlbumGuides: async () => {},
    classifySize: () => "36x12",
    getTargetDims: () => ({ targetWidth: 10800, targetHeight: 3600, targetDpi: 300 }),
    calculateGuides: () => ({ verticalGuides: [], horizontalGuides: [] }),
    ...overrides
  };
}

function createMinimalAutoFillDeps(overrides = {}) {
  const placeholder = { id: 10, name: "Frame 1", kind: 7 };
  return {
    getSelectedLayersTopToBottom: () => [placeholder],
    readBounds: () => ({ top: 0, left: 0, bottom: 600, right: 900 }),
    selectImageFiles: async () => [],
    inspectImageFiles: async files => ({
      photos: files.map((file, i) => ({
        file,
        width: 1200,
        height: 800
      })),
      errors: []
    }),
    runPlacement: async items => ({
      placedItems: items,
      failedItems: []
    }),
    moveUsedFiles: async files => ({
      moved: files,
      failed: []
    }),
    ...overrides
  };
}

// ==================================================
// PART 1 — OPEN PSD (Tests 1 to 16)
// ==================================================

test("1. OPEN PSD uses TOKEN_KEYS.OPEN_PSD ('mm_open_psd_last_folder_token')", () => {
  assert.equal(TOKEN_KEYS.OPEN_PSD, "mm_open_psd_last_folder_token");
});

test("2. OPEN PSD first use with no saved token invokes picker without initialLocation", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  let receivedPickerOptions = null;

  const deps = createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async options => {
      receivedPickerOptions = options;
      return [];
    }
  });

  const result = await executeOpenPsd(deps);
  assert.equal(result.outcome, "cancelled");
  assert.ok(receivedPickerOptions !== null);
  assert.equal(receivedPickerOptions.initialLocation, undefined, "initialLocation must not be set on first use");
});

test("3. Successful PSD selection persists the selected PSD's parent folder", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const parentFolder = { name: "WEDDING", isFolder: true, isFile: false };
  const psdFile = { name: "01.psd", isFile: true, parent: parentFolder };

  const deps = createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [psdFile]
  });

  const result = await executeOpenPsd(deps);
  assert.equal(result.outcome, "success");
  assert.equal(result.successCount, 1);

  const savedToken = storage.getItem(TOKEN_KEYS.OPEN_PSD);
  assert.ok(savedToken, "Token must be saved in storage");

  const restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "WEDDING");
});

test("4. fileEntry.parent is preferred when available", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const parentFolder = { name: "DirectParentFolder", isFolder: true, isFile: false };
  const psdFile = { name: "01.psd", isFile: true, parent: parentFolder };

  let fallbackCalled = false;
  const deps = createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    getParentFolder: async () => {
      fallbackCalled = true;
      return { name: "FallbackFolder", isFolder: true, isFile: false };
    },
    selectPsdFiles: async () => [psdFile]
  });

  await executeOpenPsd(deps);
  assert.equal(fallbackCalled, false, "getParentFolder fallback should not be called when fileEntry.parent is valid");

  const restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "DirectParentFolder");
});

test("5. existing getParentFolder fallback still works when fileEntry.parent is missing", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const psdFile = { name: "01.psd", isFile: true, parent: null };
  const fallbackFolder = { name: "FallbackResolved", isFolder: true, isFile: false };

  let fallbackCalled = false;
  const deps = createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    getParentFolder: async (file, fSys) => {
      fallbackCalled = true;
      assert.equal(file.name, "01.psd");
      assert.equal(fSys, fs);
      return fallbackFolder;
    },
    selectPsdFiles: async () => [psdFile]
  });

  await executeOpenPsd(deps);
  assert.equal(fallbackCalled, true, "getParentFolder fallback must be invoked");

  const restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "FallbackResolved");
});

test("6. next OPEN PSD restores saved folder", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const parentFolder = { name: "WEDDING", isFolder: true, isFile: false };
  const psdFile = { name: "01.psd", isFile: true, parent: parentFolder };

  // First run: save folder
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [psdFile]
  }));

  // Second run: restore folder
  let receivedInitialLocation = null;
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async options => {
      receivedInitialLocation = options.initialLocation;
      return [psdFile];
    }
  }));

  assert.ok(receivedInitialLocation, "Second run must receive restored folder as initialLocation");
  assert.equal(receivedInitialLocation.name, "WEDDING");
});

test("7. restored folder is passed as initialLocation", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const existingFolder = { name: "D_ALBUM_PSD", isFolder: true, isFile: false };
  const token = await saveFolderToken(TOKEN_KEYS.OPEN_PSD, existingFolder, fs, storage);
  assert.ok(token);

  let passedLocation = null;
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async opts => {
      passedLocation = opts.initialLocation;
      return [];
    }
  }));

  assert.equal(passedLocation, existingFolder);
});

test("8. PSD picker options remain types: ['psd'] and allowMultiple: true", async () => {
  const defaultDeps = getDefaultDependencies();
  assert.equal(typeof defaultDeps.selectPsdFiles, "function");

  // Call with mock fs
  let pickerArgs = null;
  const mockFs = {
    async getFileForOpening(opts) {
      pickerArgs = opts;
      return null;
    }
  };

  const testDeps = {
    ...defaultDeps,
    localFileSystem: mockFs,
    selectPsdFiles: async (opts = {}) => {
      const options = {
        types: ["psd"],
        allowMultiple: true
      };
      if (opts.initialLocation) options.initialLocation = opts.initialLocation;
      return mockFs.getFileForOpening(options);
    }
  };

  await testDeps.selectPsdFiles();
  assert.deepEqual(pickerArgs.types, ["psd"]);
  assert.equal(pickerArgs.allowMultiple, true);
});

test("9. selecting files from a different folder updates remembered folder", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const folderA = { name: "WEDDING", isFolder: true, isFile: false };
  const folderB = { name: "RECEPTION", isFolder: true, isFile: false };

  // 1. User selects from WEDDING
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [{ name: "01.psd", isFile: true, parent: folderA }]
  }));

  let restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "WEDDING");

  // 2. User selects from RECEPTION
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [{ name: "03.psd", isFile: true, parent: folderB }]
  }));

  restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "RECEPTION");
});

test("10. multiple PSD selection uses first file's parent only", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const folder1 = { name: "FolderOne", isFolder: true, isFile: false };
  const folder2 = { name: "FolderTwo", isFolder: true, isFile: false };
  const files = [
    { name: "01.psd", isFile: true, parent: folder1 },
    { name: "02.psd", isFile: true, parent: folder2 }
  ];

  let saveCount = 0;
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    saveFolderToken: async (key, folder, fSys, st) => {
      saveCount++;
      return saveFolderToken(key, folder, fSys, st);
    },
    selectPsdFiles: async () => files
  }));

  assert.equal(saveCount, 1, "saveFolderToken must only be called once");
  const restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "FolderOne");
});

test("11. cancelling picker preserves previous token", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const initialFolder = { name: "WEDDING", isFolder: true, isFile: false };
  const token = await saveFolderToken(TOKEN_KEYS.OPEN_PSD, initialFolder, fs, storage);

  // User opens picker and cancels
  const result = await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => []
  }));

  assert.equal(result.outcome, "cancelled");
  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), token, "Previous token must remain intact");

  const restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "WEDDING");
});

test("12. stale OPEN PSD token clears only OPEN PSD key", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  // Create valid auto photo fill token and stale open psd token
  const validAutoFolder = { name: "BRIDE_PHOTOS", isFolder: true, isFile: false };
  const autoToken = await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, validAutoFolder, fs, storage);

  const staleFolder = { name: "DELETED_PSD", isFolder: true, isFile: false, _isStale: true };
  const openToken = await saveFolderToken(TOKEN_KEYS.OPEN_PSD, staleFolder, fs, storage);

  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), openToken);
  assert.equal(storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL), autoToken);

  // Run OPEN PSD with stale folder
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => []
  }));

  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), null, "Stale OPEN PSD token must be cleared");
  assert.equal(storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL), autoToken, "AUTO PHOTO FILL token must remain untouched");
});

test("13. stale token causes picker to open normally without initialLocation", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const staleFolder = { name: "MOVED_PSD", isFolder: true, isFile: false, _isStale: true };
  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, staleFolder, fs, storage);

  let receivedPickerOpts = null;
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async opts => {
      receivedPickerOpts = opts;
      return [];
    }
  }));

  assert.ok(receivedPickerOpts !== null);
  assert.equal(receivedPickerOpts.initialLocation, undefined, "Picker must open normally without initialLocation");
});

test("14. persistent-token save failure does not prevent PSD processing", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const folder = { name: "FailingFolder", isFolder: true, isFile: false, _failToken: true };
  const psdFile = { name: "01.psd", isFile: true, parent: folder };

  const result = await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [psdFile]
  }));

  assert.equal(result.outcome, "success");
  assert.equal(result.successCount, 1);
  assert.equal(result.failureCount, 0);
});

test("15. folder is saved before PSD processing begins", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const parentFolder = { name: "EARLY_SAVE", isFolder: true, isFile: false };
  const psdFile = { name: "01.psd", isFile: true, parent: parentFolder };

  let tokenAtOpenTime = null;

  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    openDocument: async () => {
      // Check storage right when openDocument is called
      tokenAtOpenTime = storage.getItem(TOKEN_KEYS.OPEN_PSD);
      return { id: 1, name: "01.psd", layers: [] };
    },
    selectPsdFiles: async () => [psdFile]
  }));

  assert.ok(tokenAtOpenTime, "Token must be saved in storage BEFORE openDocument is called");
});

test("16. existing PSD processing behavior remains unchanged", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const parentFolder = { name: "WEDDING", isFolder: true, isFile: false };
  const psdFile = { name: "01.psd", isFile: true, parent: parentFolder };

  let renamed = false;
  let normalized = false;
  let guidesAdded = false;
  let metricsCalls = 0;

  const result = await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [psdFile],
    getDocumentMetrics: async () => {
      metricsCalls++;
      if (metricsCalls === 1) {
        return { pixelWidth: 7200, pixelHeight: 2400, resolution: 200, widthInches: 36, heightInches: 12 };
      }
      return { pixelWidth: 10800, pixelHeight: 3600, resolution: 300, widthInches: 36, heightInches: 12 };
    },
    smartRenameLayers: () => { renamed = true; },
    normalizeDocumentToPixels: async () => { normalized = true; },
    addAlbumGuides: async () => { guidesAdded = true; }
  }));

  assert.equal(result.outcome, "success");
  assert.equal(renamed, true, "Smart rename should execute");
  assert.equal(normalized, true, "Normalization should execute");
  assert.equal(guidesAdded, true, "Guides should execute");
});

// ==================================================
// PART 2 — AUTO PHOTO FILL (Tests 17 to 33)
// ==================================================

test("17. AUTO PHOTO FILL uses TOKEN_KEYS.AUTO_PHOTO_FILL ('mm_auto_photo_fill_last_folder_token')", () => {
  assert.equal(TOKEN_KEYS.AUTO_PHOTO_FILL, "mm_auto_photo_fill_last_folder_token");
});

test("18. First use with no saved token opens photo picker normally without initialLocation", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  let receivedPickerOpts = null;

  const deps = createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async opts => {
      receivedPickerOpts = opts;
      return [];
    }
  });

  const result = await executeAutoPhotoFill(null, deps);
  assert.equal(result.outcome, "cancelled");
  assert.ok(receivedPickerOpts !== null);
  assert.equal(receivedPickerOpts.initialLocation, undefined);
});

test("19. Successful photo selection persists first selected photo's parent", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const parentFolder = { name: "BRIDE", isFolder: true, isFile: false };
  const photo = { name: "IMG_001.jpg", isFile: true, parent: parentFolder };

  const deps = createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [photo]
  });

  const result = await executeAutoPhotoFill(null, deps);
  assert.equal(result.outcome, "complete");

  const token = storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL);
  assert.ok(token);

  const restored = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restored.name, "BRIDE");
});

test("20. fileEntry.parent is preferred when available in AUTO PHOTO FILL", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const directParent = { name: "BrideDirect", isFolder: true, isFile: false };
  const photo = { name: "IMG_001.jpg", isFile: true, parent: directParent };

  let fallbackCalled = false;
  const deps = createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    getParentFolder: async () => {
      fallbackCalled = true;
      return { name: "FallbackParent", isFolder: true, isFile: false };
    },
    selectImageFiles: async () => [photo]
  });

  await executeAutoPhotoFill(null, deps);
  assert.equal(fallbackCalled, false, "Fallback must not be called when photo.parent is valid");

  const restored = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restored.name, "BrideDirect");
});

test("21. getParentFolder fallback works in AUTO PHOTO FILL when parent is missing", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const photo = { name: "IMG_001.jpg", isFile: true, parent: null };
  const fallbackParent = { name: "ResolvedPhotoParent", isFolder: true, isFile: false };

  let fallbackCalled = false;
  const deps = createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    getParentFolder: async () => {
      fallbackCalled = true;
      return fallbackParent;
    },
    selectImageFiles: async () => [photo]
  });

  await executeAutoPhotoFill(null, deps);
  assert.equal(fallbackCalled, true);

  const restored = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restored.name, "ResolvedPhotoParent");
});

test("22. next AUTO PHOTO FILL restores the saved folder", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const photoFolder = { name: "BRIDE", isFolder: true, isFile: false };
  const photo = { name: "IMG_001.jpg", isFile: true, parent: photoFolder };

  // 1. First run saves folder
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [photo]
  }));

  // 2. Second run restores folder
  let receivedLocation = null;
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async opts => {
      receivedLocation = opts.initialLocation;
      return [photo];
    }
  }));

  assert.ok(receivedLocation);
  assert.equal(receivedLocation.name, "BRIDE");
});

test("23. restored folder is supplied as native picker initialLocation", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const photoFolder = { name: "CLIENT_PHOTOS", isFolder: true, isFile: false };
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, photoFolder, fs, storage);

  let passedLocation = null;
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async opts => {
      passedLocation = opts.initialLocation;
      return [];
    }
  }));

  assert.equal(passedLocation, photoFolder);
});

test("24. existing supported photo types remain unchanged (jpg, jpeg, png)", () => {
  assert.deepEqual(Array.from(SUPPORTED_IMAGE_TYPES), ["jpg", "jpeg", "png"]);
});

test("25. existing multi-photo selection remains unchanged", async () => {
  // Verify selectImageFiles passes allowMultiple: true
  let capturedOpts = null;
  const mockFs = {
    async getFileForOpening(opts) {
      capturedOpts = opts;
      return [];
    }
  };
  const testSelectImageFiles = async (options = {}) => {
    const pickerOptions = {
      allowMultiple: true,
      types: Array.from(SUPPORTED_IMAGE_TYPES)
    };
    if (options && options.initialLocation) {
      pickerOptions.initialLocation = options.initialLocation;
    }
    return mockFs.getFileForOpening(pickerOptions);
  };

  await testSelectImageFiles();
  assert.equal(capturedOpts.allowMultiple, true);
  assert.deepEqual(capturedOpts.types, ["jpg", "jpeg", "png"]);
});

test("26. changing selected photo folder updates memory", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const folderBride = { name: "BRIDE", isFolder: true, isFile: false };
  const folderGroom = { name: "GROOM", isFolder: true, isFile: false };

  // 1. Select from BRIDE
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [{ name: "01.jpg", isFile: true, parent: folderBride }]
  }));

  let restored = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restored.name, "BRIDE");

  // 2. Select from GROOM
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [{ name: "02.jpg", isFile: true, parent: folderGroom }]
  }));

  restored = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restored.name, "GROOM");
});

test("27. multiple selection uses first photo's parent only", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const folder1 = { name: "Folder1", isFolder: true, isFile: false };
  const folder2 = { name: "Folder2", isFolder: true, isFile: false };
  const photos = [
    { name: "IMG_01.jpg", isFile: true, parent: folder1 },
    { name: "IMG_02.jpg", isFile: true, parent: folder2 }
  ];

  let saveCount = 0;
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    saveFolderToken: async (key, folder, fSys, st) => {
      saveCount++;
      return saveFolderToken(key, folder, fSys, st);
    },
    selectImageFiles: async () => photos
  }));

  assert.equal(saveCount, 1, "Only first photo's parent token must be saved");
  const restored = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restored.name, "Folder1");
});

test("28. picker cancellation preserves prior photo token", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const initialFolder = { name: "BRIDE", isFolder: true, isFile: false };
  const token = await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, initialFolder, fs, storage);

  // User cancels photo picker
  const result = await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => []
  }));

  assert.equal(result.outcome, "cancelled");
  assert.equal(storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL), token, "Previous token must remain unchanged");
});

test("29. stale AUTO PHOTO FILL token clears only its own token", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const validPsdFolder = { name: "ALBUM_PSD", isFolder: true, isFile: false };
  const psdToken = await saveFolderToken(TOKEN_KEYS.OPEN_PSD, validPsdFolder, fs, storage);

  const stalePhotoFolder = { name: "DELETED_PHOTOS", isFolder: true, isFile: false, _isStale: true };
  const photoToken = await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, stalePhotoFolder, fs, storage);

  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), psdToken);
  assert.equal(storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL), photoToken);

  // Run AUTO PHOTO FILL with stale token
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => []
  }));

  assert.equal(storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL), null, "Stale AUTO PHOTO FILL token must be cleared");
  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), psdToken, "OPEN PSD token must remain intact");
});

test("30. stale token opens photo picker normally without initialLocation", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const staleFolder = { name: "DISCONNECTED_PHOTOS", isFolder: true, isFile: false, _isStale: true };
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, staleFolder, fs, storage);

  let receivedOpts = null;
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async opts => {
      receivedOpts = opts;
      return [];
    }
  }));

  assert.ok(receivedOpts !== null);
  assert.equal(receivedOpts.initialLocation, undefined);
});

test("31. token save failure does not prevent photo filling", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const folder = { name: "BadTokenFolder", isFolder: true, isFile: false, _failToken: true };
  const photo = { name: "IMG_01.jpg", isFile: true, parent: folder };

  const result = await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [photo]
  }));

  assert.equal(result.outcome, "complete");
  assert.equal(result.placedCount, 1);
});

test("32. selected folder is persisted before photo processing begins", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const parentFolder = { name: "EARLY_PHOTO_SAVE", isFolder: true, isFile: false };
  const photo = { name: "IMG_01.jpg", isFile: true, parent: parentFolder };

  let tokenAtInspectionTime = null;

  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [photo],
    inspectImageFiles: async files => {
      // Assert token is already in storage when inspection starts
      tokenAtInspectionTime = storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL);
      return {
        photos: files.map(file => ({ file, width: 1200, height: 800 })),
        errors: []
      };
    }
  }));

  assert.ok(tokenAtInspectionTime, "Token must be saved in storage BEFORE inspectImageFiles is called");
});

test("33. existing AUTO PHOTO FILL behavior remains unchanged", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const parentFolder = { name: "PHOTOS", isFolder: true, isFile: false };
  const photo = { name: "IMG_01.jpg", isFile: true, parent: parentFolder };

  let inspected = false;
  let placed = false;
  let moved = false;

  const result = await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [photo],
    inspectImageFiles: async files => {
      inspected = true;
      return { photos: files.map(file => ({ file, width: 1200, height: 800 })), errors: [] };
    },
    runPlacement: async items => {
      placed = true;
      return { placedItems: items, failedItems: [] };
    },
    moveUsedFiles: async files => {
      moved = true;
      return { moved: files, failed: [] };
    }
  }));

  assert.equal(result.outcome, "complete");
  assert.equal(inspected, true);
  assert.equal(placed, true);
  assert.equal(moved, true);
});

// ==================================================
// PART 3 — CROSS-TOOL INDEPENDENCE (Tests 34 to 41)
// ==================================================

test("34. Set OPEN PSD folder A", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderA = { name: "FOLDER_A_PSD", isFolder: true, isFile: false };

  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [{ name: "01.psd", isFile: true, parent: folderA }]
  }));

  const restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restored.name, "FOLDER_A_PSD");
});

test("35. Set AUTO PHOTO FILL folder B", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderB = { name: "FOLDER_B_PHOTOS", isFolder: true, isFile: false };

  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [{ name: "01.jpg", isFile: true, parent: folderB }]
  }));

  const restored = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restored.name, "FOLDER_B_PHOTOS");
});

test("36. OPEN PSD restores A while AUTO PHOTO FILL has B", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderA = { name: "FOLDER_A_PSD", isFolder: true, isFile: false };
  const folderB = { name: "FOLDER_B_PHOTOS", isFolder: true, isFile: false };

  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, folderA, fs, storage);
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, folderB, fs, storage);

  let initialLocationReceived = null;
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async opts => {
      initialLocationReceived = opts.initialLocation;
      return [];
    }
  }));

  assert.equal(initialLocationReceived.name, "FOLDER_A_PSD");
});

test("37. AUTO PHOTO FILL restores B while OPEN PSD has A", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderA = { name: "FOLDER_A_PSD", isFolder: true, isFile: false };
  const folderB = { name: "FOLDER_B_PHOTOS", isFolder: true, isFile: false };

  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, folderA, fs, storage);
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, folderB, fs, storage);

  let initialLocationReceived = null;
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async opts => {
      initialLocationReceived = opts.initialLocation;
      return [];
    }
  }));

  assert.equal(initialLocationReceived.name, "FOLDER_B_PHOTOS");
});

test("38. Changing OPEN PSD to folder C leaves AUTO PHOTO FILL at B", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderA = { name: "FOLDER_A_PSD", isFolder: true, isFile: false };
  const folderB = { name: "FOLDER_B_PHOTOS", isFolder: true, isFile: false };
  const folderC = { name: "FOLDER_C_PSD", isFolder: true, isFile: false };

  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, folderA, fs, storage);
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, folderB, fs, storage);

  // Change OPEN PSD to C
  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => [{ name: "02.psd", isFile: true, parent: folderC }]
  }));

  const restoredOpen = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restoredOpen.name, "FOLDER_C_PSD");

  const restoredAuto = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restoredAuto.name, "FOLDER_B_PHOTOS", "AUTO PHOTO FILL must remain B");
});

test("39. Changing AUTO PHOTO FILL to folder D leaves OPEN PSD at C", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderC = { name: "FOLDER_C_PSD", isFolder: true, isFile: false };
  const folderB = { name: "FOLDER_B_PHOTOS", isFolder: true, isFile: false };
  const folderD = { name: "FOLDER_D_PHOTOS", isFolder: true, isFile: false };

  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, folderC, fs, storage);
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, folderB, fs, storage);

  // Change AUTO PHOTO FILL to D
  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => [{ name: "photo2.jpg", isFile: true, parent: folderD }]
  }));

  const restoredAuto = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(restoredAuto.name, "FOLDER_D_PHOTOS");

  const restoredOpen = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(restoredOpen.name, "FOLDER_C_PSD", "OPEN PSD must remain C");
});

test("40. Clearing stale OPEN PSD token leaves AUTO PHOTO FILL token intact", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderD = { name: "FOLDER_D_PHOTOS", isFolder: true, isFile: false };
  const stalePsd = { name: "STALE_PSD", isFolder: true, isFile: false, _isStale: true };

  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, stalePsd, fs, storage);
  const autoToken = await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, folderD, fs, storage);

  await executeOpenPsd(createMinimalPsdDeps({
    storage,
    localFileSystem: fs,
    selectPsdFiles: async () => []
  }));

  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), null, "Stale OPEN PSD token must be cleared");
  assert.equal(storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL), autoToken, "AUTO PHOTO FILL token must remain intact");
});

test("41. Clearing stale AUTO PHOTO FILL token leaves OPEN PSD token intact", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();
  const folderC = { name: "FOLDER_C_PSD", isFolder: true, isFile: false };
  const stalePhoto = { name: "STALE_PHOTO", isFolder: true, isFile: false, _isStale: true };

  const openToken = await saveFolderToken(TOKEN_KEYS.OPEN_PSD, folderC, fs, storage);
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, stalePhoto, fs, storage);

  await executeAutoPhotoFill(null, createMinimalAutoFillDeps({
    storage,
    localFileSystem: fs,
    selectImageFiles: async () => []
  }));

  assert.equal(storage.getItem(TOKEN_KEYS.AUTO_PHOTO_FILL), null, "Stale AUTO PHOTO FILL token must be cleared");
  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), openToken, "OPEN PSD token must remain intact");
});
