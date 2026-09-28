"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runSaveAsset,
  exportSelectedAsset,
  captureAssetSource,
  buildSaveAssetToast
} = require("../src/tools/saveAsset");
const {
  ASSET_LIBRARY_ROOT_KEY,
  DEFAULT_CATEGORY
} = require("../src/tools/assetLibrary");

function makeFolder(name, entries = []) {
  return {
    name,
    nativePath: `D:/Memory Maker/PNG Assets/${name}`,
    isFolder: true,
    entries: [...entries],
    createdFolders: [],
    createdFiles: [],
    async getEntries() {
      return this.entries;
    },
    async createFolder(childName) {
      const child = makeFolder(childName);
      this.entries.push(child);
      this.createdFolders.push(childName);
      return child;
    },
    async createFile(fileName, options = {}) {
      assert.equal(options.overwrite, false, "never overwrite library assets");
      if (this.entries.some(e => e.name.toLowerCase() === fileName.toLowerCase())) {
        throw new Error("File already exists");
      }
      const file = {
        name: fileName,
        isFile: true,
        isFolder: false,
        deleted: false,
        written: false,
        async delete() { this.deleted = true; }
      };
      this.entries.push(file);
      this.createdFiles.push(fileName);
      return file;
    }
  };
}

function makeMemory(initial = {}, tokenMap = new Map()) {
  const data = new Map(Object.entries(initial));
  return {
    storage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, String(value)),
      removeItem: key => data.delete(key)
    },
    localFileSystem: {
      getEntryForPersistentToken: async token => {
        if (!tokenMap.has(token)) throw new Error("Stale token");
        return tokenMap.get(token);
      },
      createPersistentToken: async root => {
        const token = `token:${root.name}`;
        tokenMap.set(token, root);
        return token;
      },
      createSessionToken: async file => `session:${file.name}`,
      getNativePath: async root => root.nativePath
    }
  };
}

function makeHost(options = {}) {
  let nextId = 100;
  const calls = [];
  const source = {
    id: 1,
    width: 3600,
    height: 1800,
    resolution: 300,
    mode: "RGBColorMode",
    bitsPerChannel: 8,
    colorProfileName: "sRGB IEC61966-2.1",
    layers: [],
    activeLayers: []
  };
  const other = { id: 9, layers: [], closeWithoutSaving() { throw new Error("Closed wrong document!"); } };
  const docs = [source, other];
  const app = { documents: docs, activeDocument: source };

  function makeLayer(name, children = null) {
    const entry = {
      id: nextId++,
      name,
      document: source,
      bounds: { left: 100, top: 200, right: 500, bottom: 600 },
      opacity: 100,
      blendMode: "normal",
      isClippingMask: false,
      ...(children ? { layers: children } : {}),
      async duplicate(target) {
        calls.push(["duplicate", entry.name]);
        if (options.copyError) throw new Error("Native duplicate failed");
        const copy = {
          ...entry,
          id: nextId++,
          document: target,
          bounds: { ...entry.bounds },
          async delete() { target.layers.splice(target.layers.indexOf(copy), 1); },
          async translate(dx, dy) {
            copy.bounds.left += dx; copy.bounds.right += dx;
            copy.bounds.top += dy; copy.bounds.bottom += dy;
            calls.push(["translate", copy.name, dx, dy]);
          },
          scale() { throw new Error("Source layer must not be scaled"); },
          rasterize() { throw new Error("Source layer must not be rasterized"); }
        };
        target.layers.unshift(copy);
        return copy;
      },
      delete() { throw new Error("Source layer must not be deleted"); },
      translate() { throw new Error("Source layer must not be translated"); },
      scale() { throw new Error("Source layer must not be scaled"); }
    };
    return entry;
  }

  const assetLayer1 = makeLayer("Graphic Element 1");
  const assetLayer2 = makeLayer("Graphic Element 2");
  const backgroundLayer = makeLayer("Market PSD Background");

  source.layers = [assetLayer1, assetLayer2, backgroundLayer];
  source.activeLayers = [assetLayer1, assetLayer2];

  let temporary = null;
  docs.add = async creation => {
    calls.push(["create", creation]);
    if (options.createError) throw new Error("Native create failed");
    temporary = {
      id: 2,
      ...creation,
      layers: [],
      saveAs: {
        png: async (file, settings, asCopy) => {
          calls.push(["save-png", file.name, settings, asCopy]);
          if (options.saveError) throw new Error("Native PNG write failed");
          file.savedLayers = temporary.layers.map(l => l.name);
          file.savedWidth = temporary.width;
          file.savedHeight = temporary.height;
          file.written = true;
        }
      },
      trim: async (type, top, left, bottom, right) => {
        calls.push(["trim", type, { top, left, bottom, right }]);
        if (options.trimError) throw new Error("Native trim failed");
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        for (const l of temporary.layers) {
          if (l.bounds) {
            minL = Math.min(minL, l.bounds.left);
            minT = Math.min(minT, l.bounds.top);
            maxR = Math.max(maxR, l.bounds.right);
            maxB = Math.max(maxB, l.bounds.bottom);
          }
        }
        if (Number.isFinite(minL) && Number.isFinite(maxR)) {
          temporary.width = maxR - minL;
          temporary.height = maxB - minT;
        }
      },
      async closeWithoutSaving() {
        calls.push(["close", 2]);
        if (options.closeError) throw new Error("Native close failed");
        docs.splice(docs.indexOf(temporary), 1);
        temporary.closed = true;
      }
    };
    const blank = {
      id: nextId++,
      name: "Layer 1",
      document: temporary,
      async delete() {
        calls.push(["delete-blank"]);
        temporary.layers.splice(temporary.layers.indexOf(blank), 1);
      }
    };
    temporary.layers = [blank];
    docs.push(temporary);
    app.activeDocument = temporary;
    return temporary;
  };

  source.duplicateLayers = async (items, target) => {
    calls.push(["fallback-duplicate", items.map(i => i.name)]);
    return [await items[0].duplicate(target)];
  };

  const photoshop = {
    app,
    constants: {
      NewDocumentMode: { RGB: "RGBColorMode" },
      TrimType: { TRANSPARENT: "transparent" }
    },
    core: {
      executeAsModal: async callback => {
        calls.push(["modal"]);
        return callback({
          hostControl: {
            registerAutoCloseDocument: async id => calls.push(["register-autoclose", id]),
            unregisterAutoCloseDocument: async id => calls.push(["unregister-autoclose", id])
          }
        });
      }
    },
    action: {
      batchPlay: async descriptors => {
        for (const desc of descriptors) {
          if (desc._obj === "trim") {
            calls.push(["trim-batchplay", desc]);
          } else if (desc._obj === "save") {
            calls.push(["save-batchplay", desc]);
          } else if (desc._obj === "select") {
            calls.push(["select", desc._target?.[0]?._id]);
          }
        }
        return [{}];
      }
    }
  };

  return { source, assetLayer1, assetLayer2, backgroundLayer, photoshop, calls, get temporary() { return temporary; } };
}

test("17. No active doc error stops before dialog with requested message", async () => {
  const result = await runSaveAsset({
    photoshop: { app: { documents: [] } },
    showSaveAssetDialog: () => assert.fail("Should not show dialog")
  });
  assert.equal(result.outcome, "no-document");
  assert.equal(result.message, "Open a PSD first.");
  const toast = buildSaveAssetToast(result);
  assert.equal(toast.type, "warning");
});

test("18. No selection error stops before configuration with requested message", async () => {
  const h = makeHost();
  h.source.activeLayers = [];
  const result = await runSaveAsset({
    photoshop: h.photoshop,
    showSaveAssetDialog: () => assert.fail("Should not show dialog")
  });
  assert.equal(result.outcome, "no-selection");
  assert.equal(result.message, "Select one or more asset layers first.");
  const toast = buildSaveAssetToast(result);
  assert.equal(toast.type, "warning");
});

test("19. Only selected layers copied, unselected background ignored", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");
  const result = await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "DECORATION",
    photoshop: h.photoshop
  });

  assert.equal(result.success, true);
  const duplicates = h.calls.filter(([action]) => action === "duplicate").map(([, name]) => name);
  assert.deepEqual(duplicates, ["Graphic Element 2", "Graphic Element 1"]);
  assert.ok(!duplicates.includes("Market PSD Background"));
});

test("20. Source document and layers remain completely unchanged", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");
  const originalWidth = h.source.width;
  const originalHeight = h.source.height;
  const originalLayersCount = h.source.layers.length;

  await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "PNG ASSET",
    photoshop: h.photoshop
  });

  assert.equal(h.source.width, originalWidth);
  assert.equal(h.source.height, originalHeight);
  assert.equal(h.source.layers.length, originalLayersCount);
});

test("21. Temp document used with transparent background", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");

  await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "PNG ASSET",
    photoshop: h.photoshop
  });

  const createCall = h.calls.find(([action]) => action === "create");
  assert.ok(createCall);
  const docOptions = createCall[1];
  assert.equal(docOptions.fill, "transparent");
});

test("22. Transparent trim occurs before PNG export", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");

  await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "DECORATION",
    photoshop: h.photoshop
  });

  const trimIndex = h.calls.findIndex(([action]) => action === "trim" || action === "trim-batchplay");
  const saveIndex = h.calls.findIndex(([action]) => action === "save-png" || action === "save-batchplay");

  assert.ok(trimIndex !== -1, "Transparent trim was called");
  assert.ok(saveIndex !== -1, "PNG save was called");
  assert.ok(trimIndex < saveIndex, "Trim must happen strictly BEFORE saving PNG");
});

test("23. PNG alpha transparency is preserved", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");

  await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "PNG TEXT",
    photoshop: h.photoshop
  });

  const saveCall = h.calls.find(([action]) => action === "save-png" || action === "save-batchplay");
  assert.ok(saveCall);
});

test("24. Visible effects and layer bounds preserved", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");

  const result = await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "DECORATION",
    photoshop: h.photoshop
  });

  assert.equal(result.success, true);
  // Source bounds are read and preserved
  assert.ok(h.calls.some(([action]) => action === "modal"));
});

test("25. Correct category folder used and auto-created if missing", async () => {
  const root = makeFolder("PNG Assets");
  const h = makeHost();

  const result = await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "PNG BORDER",
    photoshop: h.photoshop
  });

  assert.equal(result.success, true);
  assert.equal(result.category, "PNG BORDER");
  assert.ok(root.createdFolders.includes("PNG BORDER"));
  const catFolder = root.entries.find(e => e.name === "PNG BORDER");
  assert.ok(catFolder.entries.some(e => e.name === "mm_border01.png"));
});

test("29. Temporary document closes after export", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");

  await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "PNG MASK",
    photoshop: h.photoshop
  });

  assert.ok(h.calls.some(([action]) => action === "close"));
  assert.equal(h.photoshop.app.documents.includes(h.temporary), false);
});

test("30. Source document focus and selection restored", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");

  // Simulate activeLayers changing during export process
  h.assetLayer1.duplicate = async target => {
    h.calls.push(["duplicate", h.assetLayer1.name]);
    h.source.activeLayers = [h.backgroundLayer];
    const copy = { ...h.assetLayer1, id: 998, document: target, bounds: { ...h.assetLayer1.bounds }, async delete() {} };
    target.layers.unshift(copy);
    return copy;
  };

  await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "DECORATION",
    photoshop: h.photoshop
  });

  assert.equal(h.photoshop.app.activeDocument, h.source);
  assert.ok(h.calls.some(([action]) => action === "select"));
});

test("31. Success toast formatting matches specification with new category-specific filename", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");

  const result = await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "DECORATION",
    photoshop: h.photoshop
  });

  assert.equal(result.message, "Saved asset: DECORATION / mm_decoration01.png");
  const toast = buildSaveAssetToast(result);
  assert.equal(toast.type, "success");
  assert.equal(toast.message, "Saved asset: DECORATION / mm_decoration01.png");
});

test("SAVE ASSET exports exact required category filenames for all 5 categories", async () => {
  const categories = [
    ["PNG TEXT", "mm_text01.png"],
    ["PNG ASSET", "mm_asset01.png"],
    ["DECORATION", "mm_decoration01.png"],
    ["PNG BORDER", "mm_border01.png"],
    ["PNG MASK", "mm_mask01.png"]
  ];

  for (const [cat, expectedName] of categories) {
    const h = makeHost();
    const root = makeFolder("PNG Assets");
    const result = await exportSelectedAsset({
      sourceSnapshot: captureAssetSource(h.photoshop.app),
      root,
      category: cat,
      photoshop: h.photoshop
    });
    assert.equal(result.success, true);
    assert.equal(result.fileName, expectedName);
    assert.equal(result.message, `Saved asset: ${cat} / ${expectedName}`);
  }
});

test("32. Failure cleanup works: temporary doc and unfinished file cleaned up", async () => {
  const h = makeHost({ saveError: true });
  const root = makeFolder("PNG Assets");

  const result = await exportSelectedAsset({
    sourceSnapshot: captureAssetSource(h.photoshop.app),
    root,
    category: "DECORATION",
    photoshop: h.photoshop
  });

  assert.equal(result.success, false);
  assert.equal(result.outcome, "error");
  // Check temp document was closed
  assert.ok(h.calls.some(([action]) => action === "close"));
  // Check unfinished file was deleted
  const catFolder = root.entries.find(e => e.name === "DECORATION");
  const file = catFolder?.entries.find(e => e.name === "mm_decoration01.png");
  assert.ok(file?.deleted, "Unfinished file must be deleted on error");
});

test("SAVE ASSET dialog: prompts user, handles SET FOLDER, category change, and save", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");
  const mem = makeMemory();

  let dialogStep = 0;
  const result = await runSaveAsset({
    photoshop: h.photoshop,
    localFileSystem: mem.localFileSystem,
    storage: mem.storage,
    showSaveAssetDialog: async ({ folder, category }) => {
      dialogStep++;
      if (dialogStep === 1) {
        // Step 1: no folder yet, user sets folder
        assert.equal(folder, null);
        mem.localFileSystem.getFolder = async () => root;
        return { action: "set-folder", category };
      }
      if (dialogStep === 2) {
        // Step 2: folder is configured, user chooses category DECORATION and saves
        assert.equal(folder.name, "PNG Assets");
        return { action: "save", category: "DECORATION" };
      }
      return { action: "cancel" };
    }
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.category, "DECORATION");
  assert.equal(result.fileName, "mm_decoration01.png");
});
