"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness({
  saved = new Map(),
  tokens = new Map(),
  picks = [],
  filePicks = [],
  activeDialogId = "saveAssetDialog"
} = {}) {
  const elements = new Map();

  function makeElement() {
    return {
      hidden: true,
      disabled: false,
      textContent: "",
      value: "",
      className: "",
      attributes: {},
      listeners: new Map(),
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key] ?? null; },
      focus() { this.focused = true; },
      addEventListener(event, fn) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(fn);
      },
      removeEventListener(event, fn) {
        this.listeners.get(event)?.delete(fn);
      },
      async fire(event, extra = {}) {
        for (const fn of [...(this.listeners.get(event) || [])]) {
          await fn({ preventDefault() {}, stopPropagation() {}, ...extra });
        }
      }
    };
  }

  for (const match of fs.readFileSync(path.join(__dirname, "../index.html"), "utf8").matchAll(/id="([^"]+)"/g)) {
    elements.set(match[1], makeElement());
  }

  const saveDialog = elements.get("saveAssetDialog");
  const addDialog = elements.get("addAssetDialog");
  assert.ok(saveDialog, "saveAssetDialog must exist");
  assert.ok(addDialog, "addAssetDialog must exist");

  let saveOpen = false, addOpen = false, folderCalls = 0, fileCalls = 0;
  let resolveSaveModal, resolveAddModal;

  Object.defineProperty(saveDialog, "open", { get: () => saveOpen });
  saveDialog.uxpShowModal = () => {
    saveOpen = true;
    return new Promise(resolve => { resolveSaveModal = resolve; });
  };
  saveDialog.close = reason => {
    saveOpen = false;
    resolveSaveModal?.(reason);
    void saveDialog.fire("close");
  };

  Object.defineProperty(addDialog, "open", { get: () => addOpen });
  addDialog.uxpShowModal = () => {
    addOpen = true;
    return new Promise(resolve => { resolveAddModal = resolve; });
  };
  addDialog.close = reason => {
    addOpen = false;
    resolveAddModal?.(reason);
    void addDialog.fire("close");
  };

  const source = {
    id: 10,
    width: 2000,
    height: 1000,
    resolution: 300,
    layers: [{ id: 11, name: "Asset Layer" }],
    activeLayers: []
  };
  source.activeLayers = source.layers;

  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, String(value)),
      removeItem: key => saved.delete(key)
    },
    document: {
      getElementById: id => elements.get(id) || null,
      createElement: makeElement
    },
    require: name => {
      if (name === "uxp") {
        return {
          storage: {
            localFileSystem: {
              async getFolder() {
                return picks[folderCalls++] ?? null;
              },
              async getFileForOpening() {
                return filePicks[fileCalls++] ?? null;
              },
              async createPersistentToken(f) {
                const t = `token:${f.name}`;
                tokens.set(t, f);
                return t;
              },
              async getEntryForPersistentToken(t) {
                if (!tokens.has(t)) throw new Error("Stale token");
                return tokens.get(t);
              },
              async createSessionToken(f) {
                return `session:${f.name}`;
              }
            }
          }
        };
      }
      if (name === "photoshop") {
        return {
          app: { documents: [source], activeDocument: source }
        };
      }
      return require(path.resolve(__dirname, "..", name));
    }
  };

  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"), sandbox);

  return {
    main: sandbox.module.exports,
    elements,
    saveDialog,
    addDialog,
    saved,
    source,
    get saveOpen() { return saveOpen; },
    get addOpen() { return addOpen; },
    get folderCalls() { return folderCalls; },
    get fileCalls() { return fileCalls; },
    tick: async () => { await new Promise(r => setImmediate(r)); }
  };
}

const ROOT = {
  name: "PNG Assets",
  nativePath: "D:/Memory Maker/PNG Assets",
  isFolder: true,
  entries: [],
  getEntries: async () => []
};

test("SAVE ASSET UI: first use shows SET FOLDER, disabled SAVE ASSET, default category PNG ASSET", async () => {
  const h = createHarness();
  const pending = h.main.handleSaveAsset();
  await h.tick();

  assert.equal(h.saveOpen, true);
  assert.equal(h.folderCalls, 0);
  assert.equal(h.elements.get("saveAssetFolderPath").textContent, "No asset library folder selected");
  assert.equal(h.elements.get("saveAssetFolderBtn").textContent, "SET FOLDER");
  assert.equal(h.elements.get("saveAssetSaveBtn").disabled, true);
  assert.equal(h.elements.get("saveAssetCategorySelect").value, "PNG ASSET");

  await h.elements.get("saveAssetCancelBtn").fire("click");
  const res = await pending;
  assert.equal(res.outcome, "cancelled");
});

test("SAVE ASSET UI: SET FOLDER updates path and enables SAVE ASSET", async () => {
  const h = createHarness({ picks: [ROOT] });
  const pending = h.main.handleSaveAsset();
  await h.tick();

  await h.elements.get("saveAssetFolderBtn").fire("click");
  await h.tick();

  assert.equal(h.folderCalls, 1);
  assert.equal(h.elements.get("saveAssetFolderPath").textContent, ROOT.nativePath);
  assert.equal(h.elements.get("saveAssetFolderBtn").textContent, "CHANGE FOLDER");
  assert.equal(h.elements.get("saveAssetSaveBtn").disabled, false);

  await h.elements.get("saveAssetCancelBtn").fire("click");
  await pending;
});

test("ADD ASSET UI: first use shows SET FOLDER, disabled SELECT ASSET, default category PNG ASSET", async () => {
  const h = createHarness();
  const pending = h.main.handleAddAssetLibrary();
  await h.tick();

  assert.equal(h.addOpen, true);
  assert.equal(h.folderCalls, 0);
  assert.equal(h.elements.get("addAssetFolderPath").textContent, "No asset library folder selected");
  assert.equal(h.elements.get("addAssetFolderBtn").textContent, "SET FOLDER");
  assert.equal(h.elements.get("addAssetSelectBtn").disabled, true);
  assert.equal(h.elements.get("addAssetCategorySelect").value, "PNG ASSET");

  await h.elements.get("addAssetCancelBtn").fire("click");
  const res = await pending;
  assert.equal(res.outcome, "cancelled");
});

test("ADD ASSET UI: SET FOLDER enables SELECT ASSET, and category dropdown change is remembered", async () => {
  const h = createHarness({ picks: [ROOT] });
  const pending = h.main.handleAddAssetLibrary();
  await h.tick();

  h.elements.get("addAssetCategorySelect").value = "DECORATION";
  await h.elements.get("addAssetFolderBtn").fire("click");
  await h.tick();

  assert.equal(h.elements.get("addAssetFolderPath").textContent, ROOT.nativePath);
  assert.equal(h.elements.get("addAssetFolderBtn").textContent, "CHANGE FOLDER");
  assert.equal(h.elements.get("addAssetSelectBtn").disabled, false);
  assert.equal(h.elements.get("addAssetCategorySelect").value, "DECORATION");

  await h.elements.get("addAssetCancelBtn").fire("click");
  await pending;
});
