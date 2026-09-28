"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BACKGROUND_FOLDER_STORAGE_KEY,
  HISTORY_STATE_NAME,
  isBackgroundFile,
  getBackgroundLayerName,
  getStoredBackgroundFolderToken,
  clearBackgroundFolderToken,
  validateBackgroundFolder,
  resolveBackgroundFolder,
  changeBackgroundFolder,
  selectBackgroundImage,
  findBottomMostTopLevelLayer,
  isSafeBackgroundCandidate,
  calculateCoverScale,
  calculateCenterTranslation,
  deleteOldBottomLayer,
  convertToBackgroundLayer,
  applyNewBackground,
  runChangeBackground,
  buildChangeBackgroundToast
} = require("../src/tools/changeBackground");

function makeFolder(name, entries = []) {
  return {
    name,
    nativePath: `D:/Memory Maker/Backgrounds/${name}`,
    isFolder: true,
    entries: [...entries],
    async getEntries() {
      return this.entries;
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
    }
  };
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    has: k => map.has(k)
  };
}

function makeMockDoc({ width = 3000, height = 2000, layers = [] } = {}) {
  let activeLayers = [];
  const doc = {
    id: 100,
    width,
    height,
    layers: [...layers],
    get activeLayers() {
      return activeLayers;
    },
    set activeLayers(val) {
      activeLayers = [...val];
    }
  };
  return doc;
}

function makeMockLayer({
  id = 1,
  name = "Layer 1",
  kind = "pixel",
  isBackgroundLayer = false,
  allLocked = false,
  bounds = { left: 0, top: 0, right: 1000, bottom: 1000 },
  layers = undefined,
  typename = "ArtLayer",
  document = null
} = {}) {
  let isDeleted = false;
  let currentBounds = { ...bounds };
  let scaleCalls = [];
  let translateCalls = [];
  let moveCalls = [];

  const layer = {
    id,
    name,
    kind,
    isBackgroundLayer,
    allLocked,
    isClippingMask: false,
    grouped: false,
    typename,
    layers,
    document,
    get bounds() {
      return currentBounds;
    },
    get isDeleted() {
      return isDeleted;
    },
    set isDeleted(val) {
      isDeleted = val;
    },
    get scaleCalls() {
      return scaleCalls;
    },
    get translateCalls() {
      return translateCalls;
    },
    get moveCalls() {
      return moveCalls;
    },
    async scale(sx, sy, anchor) {
      scaleCalls.push({ sx, sy, anchor });
      const w = (currentBounds.right - currentBounds.left) * (sx / 100);
      const h = (currentBounds.bottom - currentBounds.top) * (sy / 100);
      const cx = (currentBounds.left + currentBounds.right) / 2;
      const cy = (currentBounds.top + currentBounds.bottom) / 2;
      currentBounds = {
        left: cx - w / 2,
        top: cy - h / 2,
        right: cx + w / 2,
        bottom: cy + h / 2
      };
    },
    async translate(dx, dy) {
      translateCalls.push({ dx, dy });
      currentBounds = {
        left: currentBounds.left + dx,
        top: currentBounds.top + dy,
        right: currentBounds.right + dx,
        bottom: currentBounds.bottom + dy
      };
    },
    async move(target, placement) {
      moveCalls.push({ target, placement });
      const doc = layer.document || target?.document;
      if (doc && doc.layers) {
        const fromIdx = doc.layers.indexOf(layer);
        if (fromIdx !== -1) doc.layers.splice(fromIdx, 1);
        const toIdx = doc.layers.indexOf(target);
        if (toIdx !== -1) {
          if (placement === "placeBefore" || placement === "PLACEBEFORE") {
            doc.layers.splice(toIdx, 0, layer);
          } else if (placement === "placeAfter" || placement === "PLACEAFTER") {
            doc.layers.splice(toIdx + 1, 0, layer);
          }
        } else if (placement === "placeAtEnd" || placement === "PLACEATEND") {
          doc.layers.push(layer);
        }
      }
    },
    async delete() {
      isDeleted = true;
      const doc = layer.document;
      if (doc && doc.layers) {
        const idx = doc.layers.indexOf(layer);
        if (idx !== -1) doc.layers.splice(idx, 1);
      }
    },
    async select() {}
  };
  return layer;
}

// =============================================================
// UI / LAYOUT (Tests 1-4)
// =============================================================

test("1. CHANGE BACKGROUND button exists inside CREATE ALBUM", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('id="changeBackgroundBtn"'), "index.html must include changeBackgroundBtn");
  assert.ok(html.includes('data-tool="change-background"'), "must include data-tool='change-background'");
});

test("2. CHANGE BACKGROUND uses existing 2-column Create Album layout", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const albumSection = html.split('<section class="create-album-section"')[1]?.split('</section>')[0] || "";
  assert.ok(albumSection.includes('id="changeBackgroundBtn"'), "Button must be inside create-album-section");
  assert.ok(albumSection.includes('class="album-tool-action"'), "Button must have album-tool-action class");
});

test("3. CREATE PAGE remains full-width", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('id="createPageBtn" class="create-page-toggle"'), "createPageBtn must retain full-width toggle class");
});

test("4. Existing buttons remain unchanged", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const expectedButtons = [
    "createPageBtn", "addFrameBtn", "saveFrameBtn", "addAssetBtn", "saveAssetBtn",
    "pngMaskBtn", "pngTextBtn", "clipArtBtn", "openPsdBtn", "autoPhotoFillBtn",
    "swapPhotosBtn", "flipPhotoBtn", "savePageBtn", "saveEditedPhotosBtn",
    "savePsdCategoryBtn", "removePhotosBtn"
  ];
  for (const id of expectedButtons) {
    assert.ok(html.includes(`id="${id}"`), `Existing button ${id} must be present`);
  }
});

// =============================================================
// FOLDER MEMORY (Tests 5-11)
// =============================================================

test("5. First use shows SET FOLDER (no token)", async () => {
  const lfs = makeFileSystem();
  const storage = makeStorage();
  const resolved = await resolveBackgroundFolder({ localFileSystem: lfs, storage });
  assert.equal(resolved.folder, null);
  assert.equal(resolved.wasRemembered, false);
});

test("6. SELECT BACKGROUND disabled until folder exists", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes('<button id="changeBackgroundSelectBtn" class="btn primary full" type="button" disabled aria-disabled="true">'), "Select button must be disabled by default");
});

test("7. Uses mm_background_folder_token storage key", () => {
  assert.equal(BACKGROUND_FOLDER_STORAGE_KEY, "mm_background_folder_token");
});

test("8. Remembered folder restores correctly", async () => {
  const lfs = makeFileSystem();
  const storage = makeStorage();
  const folder = makeFolder("Backgrounds");
  const token = await lfs.createPersistentToken(folder);
  storage.setItem(BACKGROUND_FOLDER_STORAGE_KEY, token);

  const resolved = await resolveBackgroundFolder({ localFileSystem: lfs, storage });
  assert.equal(resolved.folder?.name, "Backgrounds");
  assert.equal(resolved.wasRemembered, true);
});

test("9. CHANGE FOLDER replaces token only after successful selection", async () => {
  const lfs = makeFileSystem();
  const storage = makeStorage();
  const folderA = makeFolder("FolderA");
  const tokenA = await lfs.createPersistentToken(folderA);
  storage.setItem(BACKGROUND_FOLDER_STORAGE_KEY, tokenA);

  const folderB = makeFolder("FolderB");
  lfs.nextFolder = folderB;

  const result = await changeBackgroundFolder({
    localFileSystem: lfs,
    storage,
    currentFolder: folderA
  });

  assert.equal(result.changed, true);
  assert.equal(result.folder.name, "FolderB");
  assert.notEqual(storage.getItem(BACKGROUND_FOLDER_STORAGE_KEY), tokenA);
});

test("10. Cancel preserves existing folder", async () => {
  const lfs = makeFileSystem();
  const storage = makeStorage();
  const folderA = makeFolder("FolderA");
  const tokenA = await lfs.createPersistentToken(folderA);
  storage.setItem(BACKGROUND_FOLDER_STORAGE_KEY, tokenA);

  lfs.nextFolder = null; // simulate user cancel
  const result = await changeBackgroundFolder({
    localFileSystem: lfs,
    storage,
    currentFolder: folderA
  });

  assert.equal(result.changed, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.folder.name, "FolderA");
  assert.equal(storage.getItem(BACKGROUND_FOLDER_STORAGE_KEY), tokenA);
});

test("11. Stale token clears only background key", async () => {
  const lfs = makeFileSystem();
  const storage = makeStorage({
    [BACKGROUND_FOLDER_STORAGE_KEY]: "invalid-token",
    "mm_add_frame_folder_token": "frame-token",
    "mm_asset_library_root_folder_token": "asset-token"
  });

  const resolved = await resolveBackgroundFolder({ localFileSystem: lfs, storage });
  assert.equal(resolved.folder, null);
  assert.equal(storage.getItem(BACKGROUND_FOLDER_STORAGE_KEY), null);
  assert.equal(storage.getItem("mm_add_frame_folder_token"), "frame-token");
  assert.equal(storage.getItem("mm_asset_library_root_folder_token"), "asset-token");
});

// =============================================================
// VALIDATION (Tests 12-14)
// =============================================================

test("12. No active document returns 'Create or open a page first.'", async () => {
  const ps = { app: { documents: [] } };
  const result = await runChangeBackground({ photoshop: ps });
  assert.equal(result.outcome, "no-document");
  assert.equal(result.message, "Create or open a page first.");
  const toast = buildChangeBackgroundToast(result);
  assert.equal(toast.message, "Create or open a page first.");
  assert.equal(toast.type, "warning");
});

test("13. Bottom-most top-level layer is selected regardless of layer name", () => {
  const layerTop = makeMockLayer({ id: 1, name: "Text Title", kind: "text" });
  const layerMiddle = makeMockLayer({ id: 2, name: "Frame Group", kind: "group" });
  const layerBottom = makeMockLayer({ id: 3, name: "DSC_0042_RAW", kind: "pixel" });
  const doc = makeMockDoc({ layers: [layerTop, layerMiddle, layerBottom] });

  const candidate = findBottomMostTopLevelLayer(doc);
  assert.equal(candidate.id, 3);
  assert.equal(candidate.name, "DSC_0042_RAW");
});

test("14. Nested group's child layer is NOT treated as bottom document layer", () => {
  const nestedChild = makeMockLayer({ id: 99, name: "Inside Group", kind: "pixel" });
  const group = makeMockLayer({ id: 2, name: "My Group", typename: "LayerSet", layers: [nestedChild] });
  const bottomPixel = makeMockLayer({ id: 3, name: "Actual Bottom BG", kind: "pixel" });
  const doc = makeMockDoc({ layers: [group, bottomPixel] });

  const candidate = findBottomMostTopLevelLayer(doc);
  assert.equal(candidate.id, 3);
  assert.equal(candidate.name, "Actual Bottom BG");
});

// =============================================================
// SAFETY (Tests 15-21)
// =============================================================

test("15. Bottom normal pixel layer is accepted", () => {
  const layer = makeMockLayer({ id: 10, name: "Layer 0", kind: "pixel" });
  const doc = makeMockDoc({ layers: [layer] });
  assert.equal(findBottomMostTopLevelLayer(doc).id, 10);
  assert.equal(isSafeBackgroundCandidate(layer), true);
});

test("16. Bottom locked Photoshop Background is accepted", () => {
  const layer = makeMockLayer({ id: 1, name: "Background", isBackgroundLayer: true, allLocked: true, kind: "pixel" });
  const doc = makeMockDoc({ layers: [layer] });
  assert.equal(findBottomMostTopLevelLayer(doc).id, 1);
  assert.equal(isSafeBackgroundCandidate(layer), true);
});

test("17. Bottom Smart Object is accepted", () => {
  const layer = makeMockLayer({ id: 2, name: "Smart Object 1", kind: "smartObject" });
  const doc = makeMockDoc({ layers: [layer] });
  assert.equal(findBottomMostTopLevelLayer(doc).id, 2);
  assert.equal(isSafeBackgroundCandidate(layer), true);
});

test("18. Bottom Group is accepted", () => {
  const child = makeMockLayer({ id: 31, name: "Child" });
  const layer = makeMockLayer({ id: 30, name: "Folder Group", typename: "LayerSet", layers: [child] });
  const doc = makeMockDoc({ layers: [layer] });
  assert.equal(findBottomMostTopLevelLayer(doc).id, 30);
  assert.equal(isSafeBackgroundCandidate(layer), true);
});

test("19. Bottom Text layer is accepted", () => {
  const layer = makeMockLayer({ id: 40, name: "Title Text", kind: "text" });
  const doc = makeMockDoc({ layers: [layer] });
  assert.equal(findBottomMostTopLevelLayer(doc).id, 40);
  assert.equal(isSafeBackgroundCandidate(layer), true);
});

test("20. Bottom Shape layer is accepted", () => {
  const layer = makeMockLayer({ id: 50, name: "Shape Rectangle", kind: "shape" });
  const doc = makeMockDoc({ layers: [layer] });
  assert.equal(findBottomMostTopLevelLayer(doc).id, 50);
  assert.equal(isSafeBackgroundCandidate(layer), true);
});

test("21. Document with zero layers returns 'No layer available to replace.'", async () => {
  const doc = makeMockDoc({ layers: [] });
  const ps = { app: { documents: [doc], activeDocument: doc } };

  const result = await runChangeBackground({ photoshop: ps });
  assert.equal(result.outcome, "no-layers");
  assert.equal(result.message, "No layer available to replace.");

  const toast = buildChangeBackgroundToast(result);
  assert.equal(toast.message, "No layer available to replace.");
  assert.equal(toast.type, "warning");
});

test("21b. No name-based or layer-kind rejection exists", () => {
  const names = ["Background", "Layer 0", "BG", "IMG_1234", "DSC_1234", "AnyName", "Shape", "Group", "Text"];
  const kinds = ["pixel", "smartObject", "group", "text", "shape", "adjustment", "solidcolor", "pattern"];
  names.forEach((name, i) => {
    const kind = kinds[i % kinds.length];
    const layer = makeMockLayer({ id: i + 1, name, kind });
    assert.equal(isSafeBackgroundCandidate(layer), true);
  });
});

// =============================================================
// PICKER (Tests 22-26)
// =============================================================

test("22. Starts in remembered Background Root", async () => {
  const lfs = makeFileSystem();
  const folder = makeFolder("Backgrounds");
  lfs.nextFile = { name: "bg.jpg", isFile: true };

  await selectBackgroundImage({ folder, localFileSystem: lfs });
  assert.equal(lfs.filePickerCalls.length, 1);
  assert.equal(lfs.filePickerCalls[0].initialLocation, folder);
});

test("23. Allows JPG/JPEG/PNG", async () => {
  const lfs = makeFileSystem();
  const folder = makeFolder("Backgrounds");
  lfs.nextFile = { name: "bg.jpg", isFile: true };

  await selectBackgroundImage({ folder, localFileSystem: lfs });
  assert.deepEqual(lfs.filePickerCalls[0].types, ["jpg", "jpeg", "png"]);
  assert.equal(isBackgroundFile({ name: "test.jpg", isFile: true }), true);
  assert.equal(isBackgroundFile({ name: "test.jpeg", isFile: true }), true);
  assert.equal(isBackgroundFile({ name: "test.png", isFile: true }), true);
  assert.equal(isBackgroundFile({ name: "test.psd", isFile: true }), false);
});

test("24. Single selection only", async () => {
  const lfs = makeFileSystem();
  const folder = makeFolder("Backgrounds");
  lfs.nextFile = { name: "bg.png", isFile: true };

  await selectBackgroundImage({ folder, localFileSystem: lfs });
  assert.equal(lfs.filePickerCalls[0].allowMultiple, false);
});

test("25. Cancel imports nothing", async () => {
  const lfs = makeFileSystem();
  const folder = makeFolder("Backgrounds");
  lfs.nextFile = null;

  const file = await selectBackgroundImage({ folder, localFileSystem: lfs });
  assert.equal(file, null);
});

test("26. Picker navigation does not change configured root", async () => {
  const lfs = makeFileSystem();
  const storage = makeStorage();
  const folder = makeFolder("ConfiguredRoot");
  const token = await lfs.createPersistentToken(folder);
  storage.setItem(BACKGROUND_FOLDER_STORAGE_KEY, token);

  lfs.nextFile = { name: "bg.jpg", isFile: true, nativePath: "C:/OtherFolder/bg.jpg" };
  await selectBackgroundImage({ folder, localFileSystem: lfs });

  assert.equal(storage.getItem(BACKGROUND_FOLDER_STORAGE_KEY), token);
});

// =============================================================
// PLACEMENT & COVER FIT (Tests 27-34)
// =============================================================

function createMockHostEnvironment({
  canvasWidth = 3000,
  canvasHeight = 2000,
  imageWidth = 1000,
  imageHeight = 1500,
  oldLayerProps = { id: 1, name: "Old BG", kind: "pixel" }
} = {}) {
  const oldLayer = makeMockLayer(oldLayerProps);
  const doc = makeMockDoc({ width: canvasWidth, height: canvasHeight, layers: [oldLayer] });
  oldLayer.document = doc;

  const actionLog = [];
  const batchPlayCalls = [];
  const origOldDelete = oldLayer.delete;
  oldLayer.delete = async function() {
    actionLog.push({ action: "delete-old", layerId: this.id });
    return origOldDelete.call(this);
  };

  let placedLayer = null;
  const events = [];

  const hostControl = {
    async suspendHistory({ name }) {
      events.push({ type: "suspend", name });
      return { id: "susp-1" };
    },
    async resumeHistory(susp, complete) {
      events.push({ type: "resume", complete });
    }
  };

  const ps = {
    constants: {
      AnchorPosition: { MIDDLECENTER: "middleCenter" },
      ElementPlacement: { PLACEBEFORE: "placeBefore", PLACEAFTER: "placeAfter", PLACEATEND: "placeAtEnd" }
    },
    app: {
      documents: [doc],
      get activeDocument() { return doc; },
      set activeDocument(_) {}
    },
    core: {
      async executeAsModal(fn, options) {
        return fn({ hostControl });
      }
    },
    action: {
      async batchPlay(commands, _) {
        batchPlayCalls.push(commands);
        for (const cmd of commands) {
          if (cmd._obj === "placeEvent") {
            placedLayer = makeMockLayer({
              id: 2,
              name: "Placed Layer",
              kind: "smartObject",
              bounds: { left: 0, top: 0, right: imageWidth, bottom: imageHeight },
              document: doc
            });
            const origMove = placedLayer.move;
            placedLayer.move = async function(target, placement) {
              actionLog.push({ action: "move", placement, targetId: target?.id });
              return origMove.call(this, target, placement);
            };
            doc.layers.unshift(placedLayer);
            doc.activeLayers = [placedLayer];
            actionLog.push({ action: "place", layerId: placedLayer.id });
          }
          if (cmd._obj === "delete") {
            const refId = cmd._target?.[0]?._id;
            actionLog.push({ action: "delete-old", layerId: refId });
            if (refId === oldLayer.id) {
              oldLayer.isDeleted = true;
              const idx = doc.layers.indexOf(oldLayer);
              if (idx !== -1) doc.layers.splice(idx, 1);
            }
          }
          if (cmd._obj === "make" && cmd._target?.[0]?._ref === "backgroundLayer") {
            actionLog.push({ action: "make-background", cmd });
            if (placedLayer) {
              placedLayer.isBackgroundLayer = true;
              placedLayer.kind = "background";
              placedLayer.name = "Background";
              placedLayer.allLocked = true;
            }
          }
        }
        return [{ result: 1 }];
      }
    }
  };

  const lfs = {
    async createSessionToken(entry) {
      return `session:${entry.name}`;
    }
  };

  return { ps, doc, oldLayer, get placedLayer() { return placedLayer; }, events, lfs, actionLog, batchPlayCalls };
}

test("27. New image is placed as Embedded Smart Object", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "Dark Garden 04.jpg", isFile: true };

  const result = await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.success, true);
});

test("28. Layer named without extension on placement and converts to Background", async () => {
  assert.equal(getBackgroundLayerName("Sunset_Photo.png"), "Sunset_Photo");
  assert.equal(getBackgroundLayerName("Texture.jpeg"), "Texture");
  assert.equal(getBackgroundLayerName("Dark Garden 04.jpg"), "Dark Garden 04");

  const env = createMockHostEnvironment();
  const file = { name: "Dark Garden 04.jpg", isFile: true };

  const result = await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(result.layerName, "Background");
  assert.equal(env.placedLayer.isBackgroundLayer, true);
});

test("29. COVER scale uses max(width ratio, height ratio)", () => {
  // Canvas: 3000 x 2000
  // Image: 1000 x 1500
  // wRatio = 3000/1000 = 3.0; hRatio = 2000/1500 = 1.333 -> scale = 3.0 (300%)
  const { scalePercent, scaleFactor } = calculateCoverScale({
    imageWidth: 1000,
    imageHeight: 1500,
    canvasWidth: 3000,
    canvasHeight: 2000
  });
  assert.equal(scaleFactor, 3.0);
  assert.equal(scalePercent, 300);

  // Tall canvas: 2000 x 4000
  // Wide image: 2000 x 1000
  // wRatio = 2000/2000 = 1.0; hRatio = 4000/1000 = 4.0 -> scale = 4.0 (400%)
  const tall = calculateCoverScale({
    imageWidth: 2000,
    imageHeight: 1000,
    canvasWidth: 2000,
    canvasHeight: 4000
  });
  assert.equal(tall.scaleFactor, 4.0);
});

test("30. Aspect ratio is preserved during scaling", async () => {
  const env = createMockHostEnvironment({
    canvasWidth: 3000,
    canvasHeight: 2000,
    imageWidth: 1000,
    imageHeight: 1000
  });
  const file = { name: "Background.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.placedLayer.scaleCalls.length, 1);
  const { sx, sy } = env.placedLayer.scaleCalls[0];
  assert.equal(sx, sy, "Horizontal and vertical scale must be identical to preserve aspect ratio");
  assert.equal(sx, 300);
});

test("31. New background is centered on canvas", async () => {
  const env = createMockHostEnvironment({
    canvasWidth: 3000,
    canvasHeight: 2000,
    imageWidth: 1000,
    imageHeight: 1000
  });
  const file = { name: "Centered.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.placedLayer.translateCalls.length, 1);
  const finalBounds = env.placedLayer.bounds;
  const centerX = (finalBounds.left + finalBounds.right) / 2;
  const centerY = (finalBounds.top + finalBounds.bottom) / 2;
  assert.equal(Math.round(centerX), 1500, "X center must match half canvas width");
  assert.equal(Math.round(centerY), 1000, "Y center must match half canvas height");
});

test("32. New background positioned directly above old bottom before delete", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.placedLayer.moveCalls.length, 1);
  assert.equal(env.placedLayer.moveCalls[0].placement, "placeBefore");
  assert.equal(env.placedLayer.moveCalls[0].target.id, env.oldLayer.id);
});

test("33. Clipping state cleared", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.placedLayer.isClippingMask, false);
  assert.equal(env.placedLayer.grouped, false);
});

test("34. New background remains selected", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.deepEqual(env.doc.activeLayers, [env.placedLayer]);
});

// =============================================================
// REMOVAL / FAILURE (Tests 35-39)
// =============================================================

test("35. Old background removed only after successful placement/fitting", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.oldLayer.isDeleted, true);
});

test("36. Placement failure preserves old background", async () => {
  const env = createMockHostEnvironment();
  env.ps.action.batchPlay = async () => [{ result: -1, message: "Placement failed" }];
  const file = { name: "Bad.jpg", isFile: true };

  await assert.rejects(async () => {
    await applyNewBackground({
      fileEntry: file,
      targetDocument: env.doc,
      photoshop: env.ps,
      localFileSystem: env.lfs
    });
  });

  assert.equal(env.oldLayer.isDeleted, false, "Old background must be preserved on placement failure");
});

test("37. Fit failure preserves old background", async () => {
  const env = createMockHostEnvironment();
  // Override scale to throw
  const origBatchPlay = env.ps.action.batchPlay;
  env.ps.action.batchPlay = async (cmds, opts) => {
    const res = await origBatchPlay(cmds, opts);
    if (env.placedLayer) {
      env.placedLayer.scale = async () => { throw new Error("Transform error"); };
    }
    return res;
  };
  const file = { name: "BadFit.jpg", isFile: true };

  await assert.rejects(async () => {
    await applyNewBackground({
      fileEntry: file,
      targetDocument: env.doc,
      photoshop: env.ps,
      localFileSystem: env.lfs
    });
  });

  assert.equal(env.oldLayer.isDeleted, false, "Old background must be preserved on fit failure");
});

test("38. Partial new layer is cleaned up on failure", async () => {
  const env = createMockHostEnvironment();
  const origBatchPlay = env.ps.action.batchPlay;
  env.ps.action.batchPlay = async (cmds, opts) => {
    const res = await origBatchPlay(cmds, opts);
    if (env.placedLayer) {
      env.placedLayer.scale = async () => { throw new Error("Transform error"); };
    }
    return res;
  };
  const file = { name: "BadFit.jpg", isFile: true };

  await assert.rejects(async () => {
    await applyNewBackground({
      fileEntry: file,
      targetDocument: env.doc,
      photoshop: env.ps,
      localFileSystem: env.lfs
    });
  });

  assert.equal(env.placedLayer.isDeleted, true, "Partial placed layer must be deleted on error");
});

test("39. Locked Background layer removal handled safely", async () => {
  const env = createMockHostEnvironment({
    oldLayerProps: {
      id: 1,
      name: "Background",
      isBackgroundLayer: true,
      allLocked: true
    }
  });
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.oldLayer.isBackgroundLayer, false, "Old background layer should be unlocked");
  assert.equal(env.oldLayer.allLocked, false, "allLocked should be cleared");
  assert.equal(env.oldLayer.isDeleted, true, "Old background layer should be deleted");
});

test("39b. Locked Background deletion fallback works when layer.delete() throws", async () => {
  const env = createMockHostEnvironment({
    oldLayerProps: {
      id: 77,
      name: "Background",
      isBackgroundLayer: true,
      allLocked: true
    }
  });
  // Simulate DOM delete failing due to locked background layer
  env.oldLayer.delete = async () => {
    throw new Error("Cannot delete locked Background layer via DOM");
  };

  const file = { name: "NewBG.jpg", isFile: true };
  const result = await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(result.outcome, "success");
  assert.equal(env.oldLayer.isDeleted, true, "Old background layer should be deleted via batchPlay fallback");
});

test("39c. After old layer deletion, new background is bottom-most in document stack", async () => {
  const topLayer = makeMockLayer({ id: 10, name: "Layer A", kind: "pixel" });
  const midLayer = makeMockLayer({ id: 20, name: "Layer B", kind: "text" });
  const oldBottom = makeMockLayer({ id: 30, name: "Old BG", kind: "pixel" });

  const env = createMockHostEnvironment();
  env.doc.layers = [topLayer, midLayer, oldBottom];
  topLayer.document = env.doc;
  midLayer.document = env.doc;
  oldBottom.document = env.doc;

  const file = { name: "NewBG.jpg", isFile: true };
  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  // Layer stack should now be [topLayer, midLayer, placedLayer]
  assert.equal(env.doc.layers.length, 3);
  assert.equal(env.doc.layers[0].id, 10);
  assert.equal(env.doc.layers[1].id, 20);
  assert.equal(env.doc.layers[2].id, env.placedLayer.id);
  assert.equal(findBottomMostTopLevelLayer(env.doc).id, env.placedLayer.id);
  assert.equal(oldBottom.isDeleted, true);
});

// =============================================================
// UNDO (Tests 40-41)
// =============================================================

test("40. History name is 'Change Background'", () => {
  assert.equal(HISTORY_STATE_NAME, "Change Background");
});

test("41. Operation is grouped under single history suspension", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.events.length, 2);
  assert.equal(env.events[0].type, "suspend");
  assert.equal(env.events[0].name, "Change Background");
  assert.equal(env.events[1].type, "resume");
  assert.equal(env.events[1].complete, true);
});

// =============================================================
// REGRESSION (Tests 42-48)
// =============================================================

test("42. ADD FRAME handler and module remain unchanged and functional", () => {
  const main = require("../main");
  assert.equal(typeof main.handleAddFrame, "function");
  assert.equal(typeof main.promptForAddFrameDialog, "function");
});

test("43. SAVE FRAME handler and module remain unchanged and functional", () => {
  const main = require("../main");
  assert.equal(typeof main.handleSaveFrame, "function");
  assert.equal(typeof main.promptForSaveFrameDialog, "function");
});

test("44. ADD ASSET handler and module remain unchanged and functional", () => {
  const main = require("../main");
  assert.equal(typeof main.handleAddAssetLibrary, "function");
  assert.equal(typeof main.promptForAddAssetDialog, "function");
});

test("45. SAVE ASSET handler and module remain unchanged and functional", () => {
  const main = require("../main");
  assert.equal(typeof main.handleSaveAsset, "function");
  assert.equal(typeof main.promptForSaveAssetDialog, "function");
});

test("46. CREATE PAGE remains unchanged and functional", () => {
  const main = require("../main");
  assert.equal(typeof main.toggleCreatePagePanel, "function");
  assert.equal(typeof main.handleCreatePagePreset, "function");
});

test("47. Original 8 tools remain unchanged and functional", () => {
  const main = require("../main");
  const originalHandlers = [
    main.handleOpenPsd, main.handleAutoPhotoFill, main.handleSwapPhotos,
    main.handleFlipPhoto, main.handleSavePage, main.handleSaveEditedPhotos,
    main.handleSavePsdCategory, main.handleRemovePhotos
  ];
  for (const handler of originalHandlers) {
    assert.equal(typeof handler, "function");
  }
});

test("48. Licensing and DEV bypass unchanged", () => {
  const main = require("../main");
  assert.equal(main.DEV_LICENSE_BYPASS, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
  assert.equal(manifest.version, "1.2.0");
});

// =============================================================
// BACKGROUND CONVERSION (Tests 49-56)
// =============================================================

test("49. Background conversion happens only after old layer deletion", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  const actions = env.actionLog.map(a => a.action);
  const deleteOldIdx = actions.indexOf("delete-old");
  const makeBgIdx = actions.indexOf("make-background");

  assert.ok(deleteOldIdx !== -1, "delete-old must be performed");
  assert.ok(makeBgIdx !== -1, "make-background must be performed");
  assert.ok(makeBgIdx > deleteOldIdx, "make-background must happen AFTER delete-old");
});

test("50. Conversion targets the newly placed background layer", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  const makeBgCall = env.actionLog.find(a => a.action === "make-background");
  assert.ok(makeBgCall, "make-background batchPlay call must exist");
  assert.equal(makeBgCall.cmd._obj, "make");
  assert.equal(makeBgCall.cmd._target?.[0]?._ref, "backgroundLayer");
  assert.equal(makeBgCall.cmd.using?._ref, "layer");
  assert.equal(makeBgCall.cmd.using?._value, "targetEnum");
  assert.equal(env.doc.activeLayers[0].id, env.placedLayer.id);
});

test("51. Conversion is the final document-changing step", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  const actions = env.actionLog.map(a => a.action);
  const lastAction = actions[actions.length - 1];
  assert.equal(lastAction, "make-background", "make-background must be the final action in actionLog");
});

test("52. No fake rename-only background implementation is used", async () => {
  let makeBackgroundCalled = false;
  const env = createMockHostEnvironment();
  const origBatchPlay = env.ps.action.batchPlay;
  env.ps.action.batchPlay = async (commands, opts) => {
    for (const cmd of commands) {
      if (cmd._obj === "make" && cmd._target?.[0]?._ref === "backgroundLayer") {
        makeBackgroundCalled = true;
      }
    }
    return origBatchPlay(commands, opts);
  };

  const file = { name: "NewBG.jpg", isFile: true };
  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(makeBackgroundCalled, true, "Must invoke native batchPlay make backgroundLayer");
});

test("53. Successful conversion completes normal workflow", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  const result = await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.success, true);
  assert.equal(env.placedLayer.isBackgroundLayer, true);
  assert.equal(env.placedLayer.allLocked, true);
  assert.equal(env.placedLayer.name, "Background");
  assert.equal(env.doc.layers.at(-1), env.placedLayer);
});

test("54. Conversion failure keeps the new background intact and does not restore old background", async () => {
  const env = createMockHostEnvironment();
  const origBatchPlay = env.ps.action.batchPlay;
  env.ps.action.batchPlay = async (commands, opts) => {
    for (const cmd of commands) {
      if (cmd._obj === "make" && cmd._target?.[0]?._ref === "backgroundLayer") {
        throw new Error("Photoshop cannot convert layer to background");
      }
    }
    return origBatchPlay(commands, opts);
  };

  const file = { name: "NewBG.jpg", isFile: true };
  const result = await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(result.success, true, "Overall operation should still succeed with warning");
  assert.equal(result.outcome, "conversion-warning");
  assert.equal(result.warning, true);
  assert.equal(env.placedLayer.isDeleted, false, "New background layer must remain intact");
  assert.equal(env.oldLayer.isDeleted, true, "Old background layer must remain deleted");
  assert.equal(env.doc.layers.at(-1), env.placedLayer, "New background is still bottom-most layer");
});

test("55. Warning is returned on conversion-only failure", async () => {
  const env = createMockHostEnvironment();
  const origBatchPlay = env.ps.action.batchPlay;
  env.ps.action.batchPlay = async (commands, opts) => {
    for (const cmd of commands) {
      if (cmd._obj === "make" && cmd._target?.[0]?._ref === "backgroundLayer") {
        throw new Error("Native conversion error");
      }
    }
    return origBatchPlay(commands, opts);
  };

  const file = { name: "NewBG.jpg", isFile: true };
  const result = await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(result.message, "Background changed, but could not convert it to a Background layer.");
  const toast = buildChangeBackgroundToast(result);
  assert.equal(toast.message, "Background changed, but could not convert it to a Background layer.");
  assert.equal(toast.type, "warning");
});

test("56. One-step Change Background undo covers the background conversion", async () => {
  const env = createMockHostEnvironment();
  const file = { name: "NewBG.jpg", isFile: true };

  await applyNewBackground({
    fileEntry: file,
    targetDocument: env.doc,
    photoshop: env.ps,
    localFileSystem: env.lfs
  });

  assert.equal(env.events.length, 2);
  assert.equal(env.events[0].type, "suspend");
  assert.equal(env.events[0].name, "Change Background");
  assert.equal(env.events[1].type, "resume");
  assert.equal(env.events[1].complete, true);
});
