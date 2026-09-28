"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { ASSET_CONFIGS } = require("../src/tools/addAsset");
const buttons = { "png-mask": "pngMaskBtn", "png-text": "pngTextBtn", "clip-art": "clipArtBtn" };
function harness({ saved = new Map(), tokens = new Map(), folderPicks = [], browserModal = false, runTool } = {}) {
  const elements = new Map();
  function element() { return { hidden: true, disabled: false, textContent: "", className: "", attributes: {}, listeners: new Map(),
    setAttribute(key, value) { this.attributes[key] = String(value); }, getAttribute(key) { return this.attributes[key] ?? null; }, focus() { this.focused = true; },
    addEventListener(event, fn) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(fn); },
    removeEventListener(event, fn) { this.listeners.get(event)?.delete(fn); },
    async fire(event, extra = {}) { for (const fn of [...(this.listeners.get(event) || [])]) await fn({ preventDefault() {}, stopPropagation() {}, ...extra }); }
  }; }
  for (const match of fs.readFileSync(path.join(__dirname, "../index.html"), "utf8").matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  const dialog = elements.get("assetDialog"); assert.ok(dialog, "shared PNG asset dialog must exist");
  let open = false, shows = 0, folderCalls = 0, fileCalls = 0, toolCalls = 0, resolveModal;
  if (!browserModal) dialog.uxpShowModal = () => { open = true; shows++; return new Promise(resolve => { resolveModal = resolve; }); };
  else dialog.showModal = () => { open = true; shows++; };
  dialog.close = reason => { open = false; resolveModal?.(reason); void dialog.fire("close"); };
  const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) },
    document: { getElementById: id => elements.get(id) || null, createElement: element },
    require: name => {
      if (name === "uxp") return { storage: { localFileSystem: {
        async getFolder() { assert.equal(open, false, "close custom dialog before native picker"); return folderPicks[folderCalls++] ?? null; },
        async getFileForOpening(options) { assert.equal(open, false); fileCalls++; assert.deepEqual(options.types, ["png"]); return null; },
        async createPersistentToken(folder) { const token = `asset:${folder.name}`; tokens.set(token, folder); return token; },
        async getEntryForPersistentToken(token) { if (!tokens.has(token)) throw new Error("stale"); return tokens.get(token); }
      } } };
      if (name === "photoshop") { const doc = { id: 20 }; return { app: { documents: [doc], activeDocument: doc } }; }
      if (name === "./src/tools/addAsset" && runTool) return { ASSET_CONFIGS, getAssetConfig: type => ASSET_CONFIGS[type],
        runAddAsset: args => { toolCalls++; return runTool(args); }, buildAssetToast: () => null };
      return require(path.resolve(__dirname, "..", name));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"), sandbox);
  return { main: sandbox.module.exports, elements, dialog, saved, tick: async () => { await new Promise(resolve => setImmediate(resolve)); },
    get open() { return open; }, get shows() { return shows; }, get folderCalls() { return folderCalls; }, get fileCalls() { return fileCalls; }, get toolCalls() { return toolCalls; } };
}
const root = { name: "Assets", nativePath: "F:/Wedding Resources/" + "Very Long Folder Name/".repeat(8) + "资产 PNGs", isFolder: true, getEntries: async () => [] };
const cancel = h => h.elements.get("assetCancelBtn").fire("click");
for (const [type, buttonId] of Object.entries(buttons)) {
  const config = ASSET_CONFIGS[type];
  test(`${config.title} opens exact shared dialog with SET FOLDER and disabled category SELECT`, async () => {
    const h = harness(), pending = h.main.handleAddAsset(type); await h.tick();
    assert.ok(h.elements.get(buttonId)); assert.equal(h.open, true); assert.equal(h.folderCalls, 0);
    assert.equal(h.elements.get("assetDialogTitle").textContent, config.title);
    assert.equal(h.elements.get("assetFolderPath").textContent, "No folder selected");
    assert.equal(h.elements.get("assetFolderBtn").textContent, "SET FOLDER");
    assert.equal(h.elements.get("assetSelectBtn").textContent, `SELECT ${config.title}`); assert.equal(h.elements.get("assetSelectBtn").disabled, true);
    await h.elements.get("assetSelectBtn").fire("keydown", { key: "Enter" }); assert.equal(h.open, true); assert.equal(h.fileCalls, 0);
    await cancel(h); assert.equal((await pending).outcome, "cancelled"); assert.equal(h.main.ui[buttonId].disabled, false);
  });
  test(`${config.title} SET FOLDER updates full path/tooltip and enables SELECT using its own key`, async () => {
    const saved = new Map([["mm_add_frame_folder_token", "frame"]]), h = harness({ saved, folderPicks: [root] });
    const pending = h.main.handleAddAsset(type); await h.tick(); await h.elements.get("assetFolderBtn").fire("keydown", { key: " " }); await h.tick();
    assert.equal(h.elements.get("assetFolderPath").textContent, root.nativePath); assert.equal(h.elements.get("assetFolderPath").getAttribute("title"), root.nativePath);
    assert.equal(h.elements.get("assetFolderBtn").textContent, "CHANGE FOLDER"); assert.equal(h.elements.get("assetSelectBtn").disabled, false);
    assert.ok(saved.get(config.storageKey)); assert.equal(saved.get("mm_add_frame_folder_token"), "frame"); assert.equal(saved.size, 2);
    await cancel(h); await pending;
  });
  test(`${config.title} restores root on reload; cancelled CHANGE and PNG picker preserve it`, async () => {
    const saved = new Map([[config.storageKey, "root"]]), tokens = new Map([["root", root]]), h = harness({ saved, tokens });
    const pending = h.main.handleAddAsset(type); await h.tick(); assert.equal(h.folderCalls, 0); assert.equal(h.elements.get("assetFolderPath").textContent, root.nativePath);
    await h.elements.get("assetFolderBtn").fire("click"); await h.tick(); assert.equal(saved.get(config.storageKey), "root");
    await h.elements.get("assetSelectBtn").fire("click"); await h.tick(); assert.equal(h.open, true); assert.equal(h.fileCalls, 1);
    assert.equal(h.elements.get("assetFolderPath").textContent, root.nativePath); assert.equal(saved.get(config.storageKey), "root"); await cancel(h); await pending;
  });
  test(`${config.title} cancelled SET leaves SELECT disabled; stale root clears only this tool`, async () => {
    const saved = new Map([[config.storageKey, "stale"], ["mm_add_frame_folder_token", "frame"], ["other-root", "other"]]), h = harness({ saved });
    const pending = h.main.handleAddAsset(type); await h.tick(); assert.equal(saved.has(config.storageKey), false); assert.equal(h.folderCalls, 0);
    await h.elements.get("assetFolderBtn").fire("click"); await h.tick(); assert.equal(h.elements.get("assetSelectBtn").disabled, true);
    assert.equal(saved.get("mm_add_frame_folder_token"), "frame"); assert.equal(saved.get("other-root"), "other"); await cancel(h); await pending;
  });
  test(`${config.title} uses license protection, keyboard binding and shared operation lock`, async () => {
    let finish; const h = harness({ runTool: args => { assert.equal(args.config.type, type); return new Promise(resolve => { finish = resolve; }); } });
    h.main.setDevLicenseBypass(false); h.main.setLicenseManager({ initialize: async () => {}, isOperational: () => false, getSnapshot: () => ({ state: "UNLICENSED" }) });
    await h.elements.get(buttonId).fire("click"); assert.equal(h.toolCalls, 0);
    h.main.setDevLicenseBypass(true); h.main.setLicenseManager(null);
    const pending = h.elements.get(buttonId).fire("keydown", { key: "Enter" }); await h.tick(); assert.equal(h.toolCalls, 1);
    for (const id of [...Object.values(buttons), "addFrameBtn", "openPsdBtn", "createPageBtn"]) {
      assert.equal(h.elements.get(id).disabled, true); assert.equal(h.elements.get(id).getAttribute("aria-disabled"), "true");
      await h.elements.get(id).fire("click");
    }
    assert.equal(h.toolCalls, 1); finish({ outcome: "cancelled" }); await pending;
    for (const id of [...Object.values(buttons), "addFrameBtn", "openPsdBtn", "createPageBtn"]) assert.equal(h.elements.get(id).disabled, false);
  });
}
for (const mode of ["Escape", "cancel", "close", "Space"]) test(`shared asset dialog ${mode} cancels and cleans handlers for later categories`, async () => {
  const h = harness({ browserModal: mode === "Space" });
  for (const type of Object.keys(buttons)) {
    const pending = h.main.promptForAssetDialog({ config: ASSET_CONFIGS[type] }); await h.tick();
    if (mode === "Escape") await h.dialog.fire("keydown", { key: "Escape" });
    else if (mode === "cancel") await h.dialog.fire("cancel");
    else if (mode === "close") h.dialog.close();
    else await h.elements.get("assetCancelBtn").fire("keydown", { key: " " });
    assert.equal((await pending).action, "cancel"); assert.equal(h.dialog.hidden, true);
    for (const element of [h.dialog, h.elements.get("assetFolderBtn"), h.elements.get("assetSelectBtn"), h.elements.get("assetCancelBtn")]) {
      for (const listeners of element.listeners.values()) assert.equal(listeners.size, 0);
    }
  }
});
test("category errors stay visible inside the reopened dialog", async () => {
  const bad = { ...root, getEntries: async () => { throw new Error("Access denied"); } }, h = harness({ folderPicks: [bad] });
  const pending = h.main.handleAddAsset("png-text"); await h.tick(); await h.elements.get("assetFolderBtn").fire("click"); await h.tick();
  assert.equal(h.elements.get("assetMessage").hidden, false); assert.match(h.elements.get("assetMessage").textContent, /Could not add PNG text\. Access denied/);
  assert.equal(h.open, true); assert.equal(h.elements.get("assetSelectBtn").disabled, true); await cancel(h); await pending;
});
