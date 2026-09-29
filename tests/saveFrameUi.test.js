"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function harness({ saved = new Map(), tokens = new Map(), picks = [], browserModal = false, runTool } = {}) {
  const elements = new Map();
  function element() { return { hidden: true, disabled: false, textContent: "", value: "", className: "", attributes: {}, listeners: new Map(),
    setAttribute(key, value) { this.attributes[key] = String(value); }, getAttribute(key) { return this.attributes[key] ?? null; }, focus() { this.focused = true; },
    addEventListener(event, fn) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(fn); },
    removeEventListener(event, fn) { this.listeners.get(event)?.delete(fn); },
    async fire(event, extra = {}) { for (const fn of [...(this.listeners.get(event) || [])]) await fn({ preventDefault() {}, stopPropagation() {}, ...extra }); }
  }; }
  for (const match of fs.readFileSync(path.join(__dirname, "../index.html"), "utf8").matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  const dialog = elements.get("saveFrameDialog"); assert.ok(dialog, "SAVE FRAME needs its own dialog");
  let open = false, shows = 0, pickerCalls = 0, toolCalls = 0, resolveModal;
  Object.defineProperty(dialog, "open", { get: () => open });
  if (!browserModal) dialog.uxpShowModal = () => { open = true; shows++; return new Promise(resolve => { resolveModal = resolve; }); };
  else dialog.showModal = () => { open = true; shows++; };
  dialog.close = reason => { open = false; resolveModal?.(reason); void dialog.fire("close"); };
  const source = { id: 20, width: 1000, height: 600, resolution: 300, layers: [{ id: 30, name: "Frame" }], activeLayers: [] }; source.activeLayers = source.layers;
  const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) },
    document: { getElementById: id => elements.get(id) || null, createElement: element },
    require: name => {
      if (name === "uxp") return { storage: { localFileSystem: {
        async getFolder() { assert.equal(open, false, "close config before native folder picker"); return picks[pickerCalls++] ?? null; },
        async createPersistentToken(folder) { const token = `save:${folder.name}`; tokens.set(token, folder); return token; },
        async getEntryForPersistentToken(token) { if (!tokens.has(token)) throw new Error("Stale"); return tokens.get(token); }
      } } };
      if (name === "photoshop") return { app: { documents: [source], activeDocument: source } };
      if (name === "./src/tools/saveFrame" && runTool) return { runSaveFrame: args => { toolCalls++; return runTool(args); }, buildSaveFrameToast: require("../src/tools/saveFrame").buildSaveFrameToast };
      return require(path.resolve(__dirname, "..", name));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"), sandbox);
  return { main: sandbox.module.exports, elements, dialog, saved, source, tick: async () => { await new Promise(resolve => setImmediate(resolve)); },
    get open() { return open; }, get shows() { return shows; }, get pickerCalls() { return pickerCalls; }, get toolCalls() { return toolCalls; } };
}
const KEY = "mm_save_frame_root_folder_token", root = { name: "Frame Library", nativePath: "D:/Memory Maker/" + "Long Folder Name/".repeat(10) + "PSD Frames", isFolder: true, getEntries: async () => [] };
const cancel = h => h.elements.get("saveFrameCancelBtn").fire("click");
test("first use shows SET FOLDER, disabled SAVE, default 3 PHOTOS, no native picker", async () => {
  const h = harness(), pending = h.main.handleSaveFrame(); await h.tick();
  assert.equal(h.open, true); assert.equal(h.pickerCalls, 0); assert.equal(h.elements.get("saveFrameFolderPath").textContent, "No frame library folder selected");
  assert.equal(h.elements.get("saveFrameFolderBtn").textContent, "SET FOLDER"); assert.equal(h.elements.get("saveFrameSaveBtn").disabled, true); assert.equal(h.elements.get("saveFramePhotoCount").value, "3");
  await h.elements.get("saveFrameSaveBtn").fire("keydown", { key: "Enter" }); assert.equal(h.open, true);
  await cancel(h); assert.equal((await pending).outcome, "cancelled"); assert.equal(h.elements.get("saveFrameBtn").disabled, false);
});
test("explicit SET FOLDER immediately displays full path/title and enables SAVE", async () => {
  const saved = new Map([["mm_add_frame_folder_token", "keep"]]), h = harness({ saved, picks: [root] });
  const pending = h.main.handleSaveFrame(); await h.tick(); h.elements.get("saveFramePhotoCount").value = "5";
  await h.elements.get("saveFrameFolderBtn").fire("keydown", { key: " " }); await h.tick();
  assert.equal(h.pickerCalls, 1); assert.equal(h.elements.get("saveFrameFolderPath").textContent, root.nativePath); assert.equal(h.elements.get("saveFrameFolderPath").getAttribute("title"), root.nativePath);
  assert.equal(h.elements.get("saveFrameFolderBtn").textContent, "CHANGE FOLDER"); assert.equal(h.elements.get("saveFrameSaveBtn").disabled, false); assert.equal(h.elements.get("saveFramePhotoCount").value, "5");
  assert.equal(saved.get(KEY), "save:Frame Library"); assert.equal(saved.get("mm_add_frame_folder_token"), "keep"); await cancel(h); await pending;
});
test("reload restores root; cancelled CHANGE FOLDER preserves root and selected count", async () => {
  const saved = new Map([[KEY, "saved"]]), h = harness({ saved, tokens: new Map([["saved", root]]) });
  const pending = h.main.handleSaveFrame(); await h.tick(); assert.equal(h.elements.get("saveFrameFolderPath").textContent, root.nativePath);
  h.elements.get("saveFramePhotoCount").value = "12"; await h.elements.get("saveFrameFolderBtn").fire("click"); await h.tick();
  assert.equal(saved.get(KEY), "saved"); assert.equal(h.elements.get("saveFrameSaveBtn").disabled, false); assert.equal(h.elements.get("saveFramePhotoCount").value, "12"); await cancel(h); await pending;
});
test("stale token and cancelled SET clear only SAVE FRAME and keep SAVE disabled", async () => {
  const saved = new Map([[KEY, "stale"], ["mm_png_mask_folder_token", "mask"], ["mm_clip_art_folder_token", "art"]]), h = harness({ saved });
  const pending = h.main.handleSaveFrame(); await h.tick(); assert.equal(saved.has(KEY), false); assert.equal(saved.size, 2);
  await h.elements.get("saveFrameFolderBtn").fire("click"); await h.tick(); assert.equal(h.elements.get("saveFrameSaveBtn").disabled, true); await cancel(h); await pending;
});
test("inaccessible chosen root keeps a useful error in the reopened dialog", async () => {
  const h = harness({ picks: [{ ...root, getEntries: async () => { throw new Error("Access denied"); } }] });
  const pending = h.main.handleSaveFrame(); await h.tick(); await h.elements.get("saveFrameFolderBtn").fire("click"); await h.tick();
  assert.equal(h.open, true); assert.equal(h.elements.get("saveFrameMessage").hidden, false); assert.match(h.elements.get("saveFrameMessage").textContent, /Could not save frame PSD\. Access denied/); await cancel(h); await pending;
});
test("dialog returns chosen count with SAVE and never submits twice", async () => {
  const h = harness(), pending = h.main.promptForSaveFrameDialog({ folder: root, photoCount: 3 }); await h.tick();
  h.elements.get("saveFramePhotoCount").value = "7"; await h.elements.get("saveFrameSaveBtn").fire("keydown", { key: "Enter" }); await h.elements.get("saveFrameSaveBtn").fire("click");
  const choice = await pending; assert.equal(choice.action, "save"); assert.equal(choice.photoCount, 7); assert.equal(h.dialog.hidden, true);
});
for (const mode of ["Escape", "cancel", "close", "Space"]) test(`SAVE FRAME ${mode} cancels and removes dialog event listeners`, async () => {
  const h = harness({ browserModal: mode === "Space" });
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = h.main.promptForSaveFrameDialog(); await h.tick();
    if (mode === "Escape") await h.dialog.fire("keydown", { key: "Escape" });
    else if (mode === "cancel") await h.dialog.fire("cancel");
    else if (mode === "close") h.dialog.close();
    else await h.elements.get("saveFrameCancelBtn").fire("keydown", { key: " " });
    assert.equal((await pending).action, "cancel"); assert.equal(h.dialog.hidden, true);
    for (const element of [h.dialog, h.elements.get("saveFrameFolderBtn"), h.elements.get("saveFrameSaveBtn"), h.elements.get("saveFrameCancelBtn")]) for (const listeners of element.listeners.values()) assert.equal(listeners.size, 0);
  }
});
test("license gate protects SAVE FRAME; keyboard activation keeps shared lock", async () => {
  let finish; const h = harness({ runTool: () => new Promise(resolve => { finish = resolve; }) });
  h.main.setLicenseManager({ initialize: async () => {}, isOperational: () => false, getSnapshot: () => ({ state: "UNACTIVATED" }) });
  await h.elements.get("saveFrameBtn").fire("click"); assert.equal(h.toolCalls, 0);
  h.main.setLicenseManager({ initialize: async () => {}, isOperational: () => true, getSnapshot: () => ({ state: "ACTIVE" }) });
  const pending = h.elements.get("saveFrameBtn").fire("keydown", { key: "Enter" }); await h.tick();
  const ids = ["saveFrameBtn", "addFrameBtn", "pngMaskBtn", "pngTextBtn", "clipArtBtn", "createPageBtn", "openPsdBtn", "savePageBtn"];
  for (const id of ids) { assert.equal(h.elements.get(id).disabled, true); assert.equal(h.elements.get(id).getAttribute("aria-disabled"), "true"); await h.elements.get(id).fire("click"); }
  assert.equal(h.toolCalls, 1); finish({ outcome: "cancelled" }); await pending; for (const id of ids) assert.equal(h.elements.get(id).disabled, false);
});
test("exceptions show error toast and release all action buttons", async () => {
  const h = harness({ runTool: () => { throw new Error("Native save denied"); } }); const result = await h.main.handleSaveFrame();
  assert.equal(result.outcome, "error"); assert.match(h.elements.get("toast").textContent, /Could not save frame PSD\./); assert.equal(h.elements.get("saveFrameBtn").disabled, false);
});
test("successful workflow reports exact destination in toast", async () => {
  const h = harness({ runTool: () => ({ outcome: "success", message: "Saved frame: 4 PHOTOS / Frame 008.psd" }) });
  await h.main.handleSaveFrame(); assert.equal(h.elements.get("toast").textContent, "Saved frame: 4 PHOTOS / Frame 008.psd"); assert.equal(h.elements.get("saveFrameBtn").disabled, false);
});
test("delayed close event from an earlier browser dialog does not cancel a newly open dialog", async () => {
  const h = harness({ browserModal: true });
  const first = h.main.promptForSaveFrameDialog(); await h.tick(); await cancel(h); await first;
  let resolved = false;
  const next = h.main.promptForSaveFrameDialog().then(choice => { resolved = true; return choice; }); await h.tick();
  await h.dialog.fire("close"); await h.tick(); assert.equal(resolved, false); assert.equal(h.dialog.hidden, false);
  await cancel(h); assert.equal((await next).action, "cancel");
});
