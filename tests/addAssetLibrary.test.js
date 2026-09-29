"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPngFile,
  activeDocument,
  noDocument,
  selectLibraryPng,
  importLibraryAsset,
  buildAddAssetToast,
  runAddAssetLibrary
} = require("../src/tools/addAssetLibraryItem");
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
    async getEntries() {
      return this.entries;
    },
    async createFolder(childName) {
      const child = makeFolder(childName);
      this.entries.push(child);
      this.createdFolders.push(childName);
      return child;
    }
  };
}

function makeFileSystem() {
  const tokens = new Map();
  let sequence = 0;
  return {
    tokens,
    filePickerCalls: [],
    folderCalls: 0,
    nextFolder: null,
    nextFile: null,
    async createPersistentToken(entry) {
      const token = `token-${++sequence}`;
      tokens.set(token, entry);
      return token;
    },
    async getEntryForPersistentToken(token) {
      if (!tokens.has(token)) throw new Error("Stale token");
      return tokens.get(token);
    },
    async getFolder() {
      this.folderCalls++;
      return this.nextFolder;
    },
    async getFileForOpening(options) {
      this.filePickerCalls.push(options);
      return this.nextFile;
    },
    async createSessionToken(entry) {
      return `session:${entry.name}`;
    },
    async getNativePath(entry) {
      return entry.nativePath || `D:/Memory Maker/PNG Assets/${entry.name}`;
    }
  };
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
}

function makeHost(options = {}) {
  let modal = false, active, selected, placedLayer;
  const events = [];
  const originalLayer = { id: 1, name: "Existing Layer", kind: "pixel" };
  const targetDoc = {
    id: 10,
    width: 3600,
    height: 1800,
    layers: [originalLayer],
    get activeLayers() { return selected; }
  };
  active = targetDoc;
  selected = [originalLayer];

  const ps = {
    constants: {
      AnchorPosition: { MIDDLECENTER: "middle" },
      ElementPlacement: { PLACEBEFORE: "before" }
    },
    app: {
      documents: [targetDoc],
      get activeDocument() { return active; },
      set activeDocument(doc) {
        assert.equal(modal, true);
        active = doc;
      }
    },
    core: {
      async executeAsModal(fn, config) {
        events.push({ type: "modal", config });
        modal = true;
        try {
          return await fn({
            hostControl: {
              async suspendHistory(cfg) {
                events.push({ type: "suspend", config: cfg });
                return "history-token";
              },
              async resumeHistory(id, commit) {
                events.push({ type: "resume", id, commit });
              }
            }
          });
        } finally {
          modal = false;
        }
      }
    },
    action: {
      async batchPlay(commands) {
        assert.equal(modal, true);
        const command = commands[0];
        events.push({ type: "action", command });

        if (command._obj === "placeEvent") {
          placedLayer = {
            id: 200,
            document: targetDoc,
            name: "Placed Layer",
            kind: "smartObject",
            isClippingMask: Boolean(options.clipped),
            bounds: {
              left: 0,
              top: 0,
              right: options.small ? 400 : 3200,
              bottom: options.small ? 300 : 1600
            },
            async scale(x, y, anchor) {
              events.push({ type: "scale", x, y, anchor });
              const b = this.bounds;
              const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
              const w = (b.right - b.left) * x / 100, h = (b.bottom - b.top) * y / 100;
              this.bounds = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
            },
            async translate(x, y) {
              events.push({ type: "translate", x, y });
              this.bounds.left += x; this.bounds.right += x;
              this.bounds.top += y; this.bounds.bottom += y;
            },
            async move(relative, where) {
              events.push({ type: "move", where });
              targetDoc.layers = [placedLayer, ...targetDoc.layers.filter(l => l !== placedLayer)];
            },
            async delete() {
              events.push({ type: "delete" });
              targetDoc.layers = targetDoc.layers.filter(l => l !== placedLayer);
            }
          };
          targetDoc.layers.unshift(placedLayer);
          selected = [placedLayer];
          return [{}];
        }

        if (command._obj === "select") {
          assert.equal(command._target[0]._id, placedLayer.id);
          selected = [placedLayer];
          return [{}];
        }

        return [{}];
      }
    }
  };

  return { ps, targetDoc, events, get placedLayer() { return placedLayer; } };
}

test("33. No active target doc returns requested error", async () => {
  const result = await importLibraryAsset({
    fileEntry: { name: "Asset 001.png", isFile: true },
    targetDocument: null,
    photoshop: { app: { documents: [] } },
    localFileSystem: makeFileSystem()
  });
  assert.equal(result.outcome, "no-document");
  assert.equal(result.message, "Create or open a page first.");
  const toast = buildAddAssetToast(result);
  assert.equal(toast.type, "warning");
});

test("34, 35, 36. File picker starts in selected category folder, PNG only, single select", async () => {
  const lfs = makeFileSystem();
  const root = makeFolder("PNG Assets");
  const catFolder = makeFolder("DECORATION");
  root.entries.push(catFolder);
  lfs.nextFile = { name: "Asset 005.png", isFile: true };

  const picked = await selectLibraryPng({
    categoryFolder: catFolder,
    localFileSystem: lfs
  });

  assert.equal(picked.name, "Asset 005.png");
  assert.equal(lfs.filePickerCalls.length, 1);
  const options = lfs.filePickerCalls[0];
  assert.equal(options.initialLocation, catFolder);
  assert.deepEqual(options.types, ["png"]);
  assert.equal(options.allowMultiple, false);
});

test("37. Cancel file picker returns null and imports nothing", async () => {
  const lfs = makeFileSystem();
  const catFolder = makeFolder("PNG ASSET");
  lfs.nextFile = null; // user cancelled file picker

  const picked = await selectLibraryPng({
    categoryFolder: catFolder,
    localFileSystem: lfs
  });
  assert.equal(picked, null);
});

test("38, 39. PNG placed as Embedded Smart Object preserving transparency", async () => {
  const h = makeHost();
  const lfs = makeFileSystem();
  const file = { name: "Asset 014.png", isFile: true };

  const result = await importLibraryAsset({
    fileEntry: file,
    category: "DECORATION",
    targetDocument: h.targetDoc,
    photoshop: h.ps,
    localFileSystem: lfs
  });

  assert.equal(result.outcome, "success");
  const placeAction = h.events.find(e => e.type === "action" && e.command._obj === "placeEvent");
  assert.ok(placeAction);
  assert.equal(placeAction.command.linked, false, "Must be Embedded (linked: false)");
  assert.equal(placeAction.command.null._path, "session:Asset 014.png");
});

test("40. Placed layer named without extension (Asset 014.png -> Asset 014)", async () => {
  const h = makeHost();
  const lfs = makeFileSystem();
  const file = { name: "Asset 014.png", isFile: true };

  await importLibraryAsset({
    fileEntry: file,
    category: "PNG ASSET",
    targetDocument: h.targetDoc,
    photoshop: h.ps,
    localFileSystem: lfs
  });

  assert.equal(h.placedLayer.name, "Asset 014");
});

test("41. Proportional scale-down occurs if asset > 80% canvas", async () => {
  const h = makeHost({ small: false }); // asset size 3200x1600 on 3600x1800 doc -> 88% width, exceeds 80% (2880)
  const lfs = makeFileSystem();
  const file = { name: "Large Asset.png", isFile: true };

  await importLibraryAsset({
    fileEntry: file,
    category: "PNG BORDER",
    targetDocument: h.targetDoc,
    photoshop: h.ps,
    localFileSystem: lfs
  });

  const scaleEvent = h.events.find(e => e.type === "scale");
  assert.ok(scaleEvent, "Large asset must be scaled down");
  assert.ok(scaleEvent.x < 100);
  assert.equal(scaleEvent.x, scaleEvent.y, "Scale must be proportional");
});

test("42. Small asset is not enlarged", async () => {
  const h = makeHost({ small: true }); // asset size 400x300 on 3600x1800 doc -> well under 80%
  const lfs = makeFileSystem();
  const file = { name: "Small Asset.png", isFile: true };

  await importLibraryAsset({
    fileEntry: file,
    category: "DECORATION",
    targetDocument: h.targetDoc,
    photoshop: h.ps,
    localFileSystem: lfs
  });

  const scaleEvent = h.events.find(e => e.type === "scale");
  assert.equal(scaleEvent, undefined, "Small asset must not be scaled/enlarged");
});

test("43. Asset is centered on canvas", async () => {
  const h = makeHost({ small: true });
  const lfs = makeFileSystem();
  const file = { name: "Asset 002.png", isFile: true };

  await importLibraryAsset({
    fileEntry: file,
    category: "DECORATION",
    targetDocument: h.targetDoc,
    photoshop: h.ps,
    localFileSystem: lfs
  });

  const translateEvent = h.events.find(e => e.type === "translate");
  assert.ok(translateEvent, "Asset must be centered");
  const b = h.placedLayer.bounds;
  const centerX = (b.left + b.right) / 2;
  const centerY = (b.top + b.bottom) / 2;
  assert.equal(centerX, h.targetDoc.width / 2);
  assert.equal(centerY, h.targetDoc.height / 2);
});

test("44. Placed asset remains selected after placement", async () => {
  const h = makeHost();
  const lfs = makeFileSystem();
  const file = { name: "Asset 007.png", isFile: true };

  await importLibraryAsset({
    fileEntry: file,
    category: "PNG ASSET",
    targetDocument: h.targetDoc,
    photoshop: h.ps,
    localFileSystem: lfs
  });

  const selectAction = h.events.find(e => e.type === "action" && e.command._obj === "select");
  assert.ok(selectAction, "Must explicitly select placed layer");
  assert.equal(selectAction.command._target[0]._id, h.placedLayer.id);
});

test("45. Undo history name is Add Asset", async () => {
  const h = makeHost();
  const lfs = makeFileSystem();
  const file = { name: "Asset 001.png", isFile: true };

  await importLibraryAsset({
    fileEntry: file,
    category: "PNG TEXT",
    targetDocument: h.targetDoc,
    photoshop: h.ps,
    localFileSystem: lfs
  });

  const modalEvent = h.events.find(e => e.type === "modal");
  assert.equal(modalEvent.config.commandName, "Add Asset");

  const suspendEvent = h.events.find(e => e.type === "suspend");
  assert.equal(suspendEvent.config.name, "Add Asset");
});

test("ADD ASSET dialog: prompts user, handles SET FOLDER, category change, and import", async () => {
  const h = makeHost();
  const root = makeFolder("PNG Assets");
  const lfs = makeFileSystem();
  const storage = makeStorage();

  const file = { name: "Asset 003.png", isFile: true };
  lfs.nextFile = file;

  let dialogStep = 0;
  const result = await runAddAssetLibrary({
    photoshop: h.ps,
    localFileSystem: lfs,
    storage,
    showAddAssetDialog: async ({ folder, category }) => {
      dialogStep++;
      if (dialogStep === 1) {
        assert.equal(folder, null);
        lfs.nextFolder = root;
        return { action: "set-folder", category };
      }
      if (dialogStep === 2) {
        assert.equal(folder.name, "PNG Assets");
        return { action: "select", category: "DECORATION" };
      }
      return { action: "cancel" };
    }
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.layer.name, "Asset 003");
  assert.equal(result.category, "DECORATION");
});
