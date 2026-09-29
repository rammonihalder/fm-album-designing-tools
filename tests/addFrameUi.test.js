"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function harness({ saved = new Map(), tokens = new Map(), folderPicks = [], browserModal = false, runTool, fileResult = null } = {}) {
  const elements = new Map();
  function element() { return { hidden: true, disabled: false, textContent: "", className: "", attributes: {}, listeners: new Map(), children: [],
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener(event, fn) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(fn); },
    removeEventListener(event, fn) { this.listeners.get(event)?.delete(fn); },
    async fire(event, extra = {}) { for (const fn of [...(this.listeners.get(event) || [])]) await fn({ preventDefault() {}, stopPropagation() {}, ...extra }); }, focus() { this.focused = true; }
  }; }
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  const dialog = elements.get("addFrameDialog"); assert.ok(dialog, "new ADD FRAME configuration dialog must exist");
  let open = false, resolveModal, shows = 0, folderCalls = 0, fileCalls = 0, toolCalls = 0;
  if (!browserModal) dialog.uxpShowModal = () => { open = true; shows++; return new Promise(resolve => { resolveModal = resolve; }); };
  else dialog.showModal = () => { open = true; shows++; };
  dialog.close = reason => { open = false; resolveModal?.(reason); void dialog.fire("close"); };
  const sandbox = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) },
    document: { getElementById: id => elements.get(id) || null, createElement: element },
    require: name => {
      if (name === "uxp") return { storage: { localFileSystem: {
        async getFolder() { assert.equal(open, false); return folderPicks[folderCalls++] ?? null; },
        async getFileForOpening(options) { assert.equal(open, false); fileCalls++; assert.ok(options.initialLocation); return fileResult; },
        async createPersistentToken(folder) { const token = "root:" + folder.name; tokens.set(token, folder); return token; },
        async getEntryForPersistentToken(token) { if (!tokens.has(token)) throw new Error("stale"); return tokens.get(token); }
      } } };
      if (name === "photoshop") { const doc = { id: 20 }; return { app: { documents: [doc], activeDocument: doc } }; }
      if (name === "./src/tools/addFrame" && runTool) return { runAddFrame: async args => { toolCalls++; return runTool(args); }, buildAddFrameToast: () => null };
      return require(path.resolve(__dirname, "..", name));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"), sandbox);
  return { main: sandbox.module.exports, elements, dialog, saved, tokens, tick: async () => { await new Promise(resolve => setImmediate(resolve)); },
    get open() { return open; }, get shows() { return shows; }, get folderCalls() { return folderCalls; }, get fileCalls() { return fileCalls; }, get toolCalls() { return toolCalls; } };
}
const root = { name: "PSD Frames", nativePath: "F:/Wedding Resources/PSD Frames", isFolder: true, getEntries: async () => [] };
async function cancel(h) { await h.elements.get("addFrameCancelBtn").fire("click"); }

test("ADD FRAME first use opens config without prompting and disables SELECT PSD FRAME", async () => {
  const h = harness(), pending = h.main.handleAddFrame(); await h.tick();
  assert.equal(h.open, true); assert.equal(h.dialog.hidden, false); assert.equal(h.folderCalls, 0);
  assert.equal(h.elements.get("addFrameFolderPath").textContent, "No frame folder selected");
  assert.equal(h.elements.get("addFrameFolderBtn").textContent, "SET FOLDER");
  assert.equal(h.elements.get("addFrameSelectBtn").disabled, true);
  await h.elements.get("addFrameSelectBtn").fire("keydown", { key: "Enter" }); assert.equal(h.open, true); assert.equal(h.fileCalls, 0);
  await cancel(h); assert.equal((await pending).outcome, "cancelled"); assert.equal(h.main.ui.addFrameBtn.disabled, false);
});
test("cancelled SET FOLDER reopens unconfigured dialog and writes no token", async () => {
  const h = harness(), pending = h.main.handleAddFrame(); await h.tick();
  await h.elements.get("addFrameFolderBtn").fire("keydown", { key: " " }); await h.tick();
  assert.equal(h.shows, 2); assert.equal(h.folderCalls, 1); assert.equal(h.saved.has("mm_add_frame_folder_token"), false);
  assert.equal(h.elements.get("addFrameSelectBtn").disabled, true); await cancel(h); await pending;
});
test("SET FOLDER updates path and tooltip immediately and enables SELECT PSD FRAME", async () => {
  const h = harness({ folderPicks: [root] }), pending = h.main.handleAddFrame(); await h.tick();
  await h.elements.get("addFrameFolderBtn").fire("click"); await h.tick();
  assert.equal(h.elements.get("addFrameFolderPath").textContent, root.nativePath);
  assert.equal(h.elements.get("addFrameFolderPath").getAttribute("title"), root.nativePath);
  assert.equal(h.elements.get("addFrameFolderBtn").textContent, "CHANGE FOLDER");
  assert.equal(h.elements.get("addFrameSelectBtn").disabled, false); assert.ok(h.saved.get("mm_add_frame_folder_token")); await cancel(h); await pending;
});
test("remembered root appears on reload without folder picker", async () => {
  const saved = new Map([["mm_add_frame_folder_token", "root"]]), tokens = new Map([["root", root]]);
  const h = harness({ saved, tokens }), pending = h.main.handleAddFrame(); await h.tick();
  assert.equal(h.elements.get("addFrameFolderPath").textContent, root.nativePath); assert.equal(h.folderCalls, 0); await cancel(h); await pending;
});
test("cancel CHANGE FOLDER or file picker returns to unchanged root config", async () => {
  const saved = new Map([["mm_add_frame_folder_token", "root"]]), tokens = new Map([["root", root]]);
  const h = harness({ saved, tokens }), pending = h.main.handleAddFrame(); await h.tick();
  await h.elements.get("addFrameFolderBtn").fire("click"); await h.tick();
  assert.equal(saved.get("mm_add_frame_folder_token"), "root");
  await h.elements.get("addFrameSelectBtn").fire("keydown", { key: "Enter" }); await h.tick();
  assert.equal(h.shows, 3); assert.equal(h.fileCalls, 1); assert.equal(saved.get("mm_add_frame_folder_token"), "root");
  assert.equal(h.elements.get("addFrameFolderPath").textContent, root.nativePath); await cancel(h); await pending;
});
test("stale root shows SET FOLDER and clears only its own token", async () => {
  const saved = new Map([["mm_add_frame_folder_token", "stale"], ["mm_save_page_last_folder_token", "save"]]);
  const h = harness({ saved }), pending = h.main.handleAddFrame(); await h.tick();
  assert.equal(saved.has("mm_add_frame_folder_token"), false); assert.equal(saved.get("mm_save_page_last_folder_token"), "save");
  assert.equal(h.elements.get("addFrameFolderBtn").textContent, "SET FOLDER"); assert.equal(h.elements.get("addFrameSelectBtn").disabled, true);
  assert.equal(h.folderCalls, 0); await cancel(h); await pending;
});
test("folder selection failure stays visibly explained inside the reopened configuration dialog", async () => {
  const badRoot = { ...root, getEntries: async () => { throw new Error("Access denied to Frame Root Folder"); } };
  const h = harness({ folderPicks: [badRoot, null, root] }), pending = h.main.handleAddFrame(); await h.tick();
  await h.elements.get("addFrameFolderBtn").fire("click"); await h.tick();
  const message = h.elements.get("addFrameMessage");
  assert.ok(message, "retry errors must be visible inside the dialog");
  assert.equal(message.hidden, false); assert.equal(message.textContent, "Access denied to Frame Root Folder");
  assert.equal(h.open, true); assert.equal(h.elements.get("addFrameSelectBtn").disabled, true);
  assert.equal(h.saved.has("mm_add_frame_folder_token"), false);
  await h.elements.get("addFrameFolderBtn").fire("click"); await h.tick();
  assert.equal(message.hidden, false); assert.equal(message.textContent, "Access denied to Frame Root Folder");
  await h.elements.get("addFrameFolderBtn").fire("click"); await h.tick();
  assert.equal(message.hidden, true); assert.equal(message.textContent, "");
  assert.equal(h.elements.get("addFrameSelectBtn").disabled, false); assert.ok(h.saved.get("mm_add_frame_folder_token"));
  await cancel(h); await pending;
});
for (const mode of ["Escape", "cancel", "close", "Space"]) test(`${mode} cancels config and handlers are cleaned for reopening`, async () => {
  const h = harness({ browserModal: mode === "Space" });
  for (let i = 0; i < 2; i++) {
    const pending = h.main.promptForAddFrameDialog({ folder: null }); await h.tick(); assert.equal(h.open, true);
    if (mode === "Escape") await h.dialog.fire("keydown", { key: "Escape" });
    else if (mode === "cancel") await h.dialog.fire("cancel");
    else if (mode === "close") h.dialog.close();
    else await h.elements.get("addFrameCancelBtn").fire("keydown", { key: " " });
    assert.equal((await pending).action, "cancel"); assert.equal(h.dialog.hidden, true);
    for (const el of [h.dialog, h.elements.get("addFrameFolderBtn"), h.elements.get("addFrameSelectBtn"), h.elements.get("addFrameCancelBtn")]) {
      for (const listeners of el.listeners.values()) assert.equal(listeners.size, 0);
    }
  }
});
test("ADD FRAME retains license gate and locks existing tools until completed", async () => {
  let finish; const h = harness({ runTool: () => new Promise(resolve => { finish = resolve; }) });
  h.main.setLicenseManager({ initialize: async () => {}, isOperational: () => false, getSnapshot: () => ({ state: "UNACTIVATED" }) });
  await h.main.ui.addFrameBtn.fire("click"); assert.equal(h.toolCalls, 0);
  h.main.setLicenseManager({ initialize: async () => {}, isOperational: () => true, getSnapshot: () => ({ state: "ACTIVE" }) });
  const pending = h.main.ui.addFrameBtn.fire("keydown", { key: "Enter" }); await h.tick(); assert.equal(h.toolCalls, 1);
  await h.main.ui.createPageBtn.fire("click"); assert.equal(h.main.ui.createPagePresetPanel.hidden, true);
  await h.main.ui.addFrameBtn.fire("click"); assert.equal(h.toolCalls, 1);
  finish({ outcome: "success" }); await pending; assert.equal(h.main.ui.addFrameBtn.disabled, false);
  await h.main.ui.createPageBtn.fire("click"); assert.equal(h.main.ui.createPagePresetPanel.hidden, false);
});
