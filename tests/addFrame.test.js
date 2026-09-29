"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const tool = require("../src/tools/addFrame");
const KEY = "mm_add_frame_folder_token";
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values };
}
function folder(name = "Frames") { return { name, nativePath: `F:/Resources/${name}`, isFolder: true, getEntries: async () => [] }; }
function fileSystem() {
  const tokens = new Map(); let sequence = 0;
  return { tokens, pickerOptions: [], folderPicks: 0, nextFolder: null, nextFile: null,
    async createPersistentToken(entry) { const token = `root-${++sequence}`; tokens.set(token, entry); return token; },
    async getEntryForPersistentToken(token) { if (!tokens.has(token)) throw new Error("Missing folder"); return tokens.get(token); },
    async getFolder() { this.folderPicks++; return this.nextFolder; },
    async getFileForOpening(options) { this.pickerOptions.push(options); return this.nextFile; }
  };
}
const frameFile = { name: "Classic Wedding Frame.PSD", isFile: true, parent: folder("Other Location") };
// Mirror only the native host boundary. Actual PSD fidelity requires Photoshop.
function importHost(options = {}) {
  let modal = false, active, selected, closeCalls = 0, group, nextCopyId = 100;
  const events = [], original = { id: 1, name: "Album layer" };
  const target = { id: 20, name: "Album Page", width: 1000, height: 800, layers: [original], get activeLayers() { return selected; },
    closeWithoutSaving() { assert.fail("never close the target album document"); } };
  selected = [original]; active = target;
  const source = { id: 30, name: frameFile.name, layers: options.empty ? [] : [
    { id: 11, name: "Editable title", kind: "text", opacity: 80, textItem: { contents: "Wedding" }, layerEffects: { stroke: true } },
    { id: 12, name: "Nested frame", kind: "group", layers: [
      { id: 13, name: "Existing Smart Object", kind: "smartObject", mask: { enabled: true } },
      { id: 14, name: "Clipped shape", kind: "shape", isClippingMask: true, vectorMask: { enabled: true } }
    ] }, { id: 15, name: "Adjustment", kind: "adjustment", blendMode: "multiply" }
  ],
    async duplicateLayers(layers, destination) {
      assert.equal(layers.length, 1, "fallback may duplicate only the failing top-level layer");
      return [duplicate(layers[0], destination, "fallback")];
    },
    async closeWithoutSaving() {
      assert.equal(modal, true); closeCalls++; events.push({ type: "closeWithoutSaving" });
      if (options.closeError && closeCalls === 1) throw new Error("Close source failed");
      ps.app.documents = ps.app.documents.filter(doc => doc !== source);
    }
  };
  if (options.background) source.layers.push({ id: 16, name: "Background", kind: "normal", isBackgroundLayer: true, allLocked: true });
  function duplicate(layer, destination, method) {
    assert.equal(modal, true); assert.equal(destination, target); assert.equal(active, source);
    assert.ok(source.layers.includes(layer), "never transfer nested children individually");
    events.push({ type: "duplicate", method, name: layer.name, id: layer.id, destination });
    const fails = options.duplicateError && layer.name === "Nested frame" || options[method + "Failure"] === layer.name;
    const copy = { ...structuredClone(layer), id: nextCopyId++ };
    Object.defineProperty(copy, "document", { value: target });
    Object.defineProperty(copy, "delete", { value: () => {
      assert.equal(modal, true); assert.equal(active, target); events.push({ type: "delete", name: copy.name, id: copy.id });
      target.layers = target.layers.filter(item => item !== copy);
    } });
    if (!fails || options[method + "Partial"]) { target.layers.unshift(copy); active = target; }
    if (fails) {
      const error = new Error(method === "layer" ? "Native layer duplicate rejected" : "Native single-layer fallback rejected");
      error.name = "PhotoshopError"; throw error;
    }
    if (method === "layer" && options.invalidPrimary === layer.name) return layer;
    return copy;
  }
  for (const layer of source.layers) {
    Object.defineProperty(layer, "document", { value: source });
    Object.defineProperty(layer, "duplicate", { value: async destination => duplicate(layer, destination, "layer") });
  }
  target.createLayerGroup = async ({ name, fromLayers }) => {
    assert.equal(modal, true); assert.equal(active, target); assert.equal(fromLayers.includes(original), false);
    for (const layer of fromLayers) { assert.equal(layer.document, target); assert.equal(source.layers.includes(layer), false); }
    events.push({ type: "group", name, fromLayers });
    group = { id: 200, name, kind: "group", layers: target.layers.filter(layer => fromLayers.includes(layer)),
      bounds: { left: 0, top: 0, right: options.small ? 200 : 1600, bottom: options.small ? 100 : 400 },
      async scale(x, y, anchor) {
        assert.equal(modal, true); events.push({ type: "scale", x, y, anchor });
        if (options.transformError) throw new Error("Scale failed");
        const b = this.bounds, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
        const w = (b.right - b.left) * x / 100, h = (b.bottom - b.top) * y / 100;
        this.bounds = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
      },
      async translate(x, y) { assert.equal(modal, true); events.push({ type: "translate", x, y });
        for (const edge of ["left", "right"]) this.bounds[edge] += x;
        for (const edge of ["top", "bottom"]) this.bounds[edge] += y;
      }
    };
    target.layers = [group, ...target.layers.filter(layer => !fromLayers.includes(layer))];
    if (options.groupError) throw new Error("Group failed after creation");
    return group;
  };
  const ps = { constants: { AnchorPosition: { MIDDLECENTER: "middleCenter" }, LayerKind: { GROUP: "group" } },
    app: { documents: options.alreadyOpen ? [target, source] : [target], get activeDocument() { return active; },
      set activeDocument(doc) { assert.equal(modal, true); active = doc; events.push({ type: "activate", id: doc.id }); },
      async open(entry) { assert.equal(modal, true); assert.equal(entry, frameFile); events.push({ type: "open" });
        if (options.openError) throw new Error("Source could not open");
        if (options.sameTarget) return target;
        if (!this.documents.includes(source)) this.documents.push(source);
        active = source; return source;
      }
    },
    core: { async executeAsModal(fn, command) { events.push({ type: "modal", command }); modal = true;
      try { return await fn({ hostControl: {
        async suspendHistory(config) { events.push({ type: "suspend", config }); return "history-id"; },
        async resumeHistory(id, commit) { events.push({ type: "resume", id, commit }); if (commit === false) { target.layers = [original]; selected = [original]; } },
        async registerAutoCloseDocument(id) { events.push({ type: "registerClose", id }); },
        async unregisterAutoCloseDocument(id) { events.push({ type: "unregisterClose", id }); }
      } }); } finally { modal = false; }
    } },
    action: { async batchPlay(commands) { assert.equal(modal, true);
      for (const command of commands) { assert.equal(command._obj, "select", "never place, flatten, rasterize, merge, convert or save");
        if (options.selectError) return [{ _obj: "error", result: -25922, message: "Select group failed" }];
        assert.equal(command._target[0]._id, group.id); selected = [group]; events.push({ type: "select" });
      } return [{}];
    } }
  };
  return { ps, target, source, original, events, get group() { return group; }, get closeCalls() { return closeCalls; } };
}
function importFrame(h) { assert.equal(typeof tool.importPsdFrame, "function", "editable PSD import must exist"); return tool.importPsdFrame({ fileEntry: frameFile, photoshop: h.ps }); }

test("unconfigured ADD FRAME restores no folder without a picker", async () => {
  const fs = fileSystem(); let prompts = 0;
  const result = await tool.resolveFrameFolder({ storage: storage(), localFileSystem: fs, promptForFolder: async () => { prompts++; return null; } });
  assert.equal(result.folder, null); assert.equal(prompts, 0); assert.equal(fs.folderPicks, 0);
});
test("SET FOLDER persists the dedicated token across controller instances", async () => {
  const fs = fileSystem(), saved = storage(), root = folder(); fs.nextFolder = root;
  await tool.changeFrameFolder({ storage: saved, localFileSystem: fs }); assert.ok(saved.getItem(KEY));
  assert.equal((await tool.resolveFrameFolder({ storage: saved, localFileSystem: fs })).folder, root); assert.equal(fs.folderPicks, 1);
});
test("CHANGE FOLDER validates readability before replacing token", async () => {
  const fs = fileSystem(), saved = storage({ [KEY]: "old" });
  fs.nextFolder = { ...folder(), getEntries: async () => { assert.equal(saved.getItem(KEY), "old"); } };
  await tool.changeFrameFolder({ storage: saved, localFileSystem: fs }); assert.notEqual(saved.getItem(KEY), "old");
});
test("CHANGE FOLDER cancellation preserves root and token", async () => {
  const fs = fileSystem(), saved = storage({ [KEY]: "old" }), root = folder();
  const result = await tool.changeFrameFolder({ storage: saved, localFileSystem: fs, currentFolder: root });
  assert.equal(result.folder, root); assert.equal(result.cancelled, true); assert.equal(saved.getItem(KEY), "old");
});
test("unreadable folder selection preserves old token", async () => {
  const fs = fileSystem(), saved = storage({ [KEY]: "old" }); fs.nextFolder = { ...folder(), getEntries: async () => { throw new Error("Access denied"); } };
  await assert.rejects(tool.changeFrameFolder({ storage: saved, localFileSystem: fs }), /Access denied/); assert.equal(saved.getItem(KEY), "old");
});
test("persistent token creation failure preserves old token", async () => {
  const fs = fileSystem(), saved = storage({ [KEY]: "old" }); fs.nextFolder = folder(); fs.createPersistentToken = async () => { throw new Error("Token denied"); };
  await assert.rejects(tool.changeFrameFolder({ storage: saved, localFileSystem: fs }), /remember/i); assert.equal(saved.getItem(KEY), "old");
});
for (const inaccessible of [false, true]) test(`stale ${inaccessible ? "inaccessible" : "unresolved"} root clears only ADD FRAME token`, async () => {
  const others = { mm_open_psd_last_folder_token: "a", mm_auto_photo_fill_last_folder_token: "b", mm_save_page_last_folder_token: "c", mm_save_edited_photos_folder_token: "d", mm_save_psd_category_base_folder_token: "e" };
  const saved = storage({ ...others, [KEY]: "bad" }), fs = fileSystem();
  if (inaccessible) fs.tokens.set("bad", { ...folder(), getEntries: async () => { throw new Error("Access denied"); } });
  assert.equal((await tool.resolveFrameFolder({ storage: saved, localFileSystem: fs })).folder, null);
  assert.deepEqual(Object.fromEntries(saved.values), others); assert.equal(fs.folderPicks, 0);
});
test("native PSD picker starts at configured root with a single PSD filter", async () => {
  assert.equal(typeof tool.selectPsdFrame, "function"); const fs = fileSystem(), root = folder(); fs.nextFile = frameFile;
  assert.equal(await tool.selectPsdFrame({ folder: root, localFileSystem: fs }), frameFile);
  assert.deepEqual(fs.pickerOptions[0], { initialLocation: root, types: ["psd"], allowMultiple: false });
});
test("file picker cancellation returns no frame", async () => {
  assert.equal(typeof tool.selectPsdFrame, "function"); assert.equal(await tool.selectPsdFrame({ folder: folder(), localFileSystem: fileSystem() }), null);
});
test("non-PSD files are rejected even if native filtering is ignored", async () => {
  assert.equal(typeof tool.selectPsdFrame, "function"); const fs = fileSystem(); fs.nextFile = { name: "Photo.jpg", isFile: true };
  await assert.rejects(tool.selectPsdFrame({ folder: folder(), localFileSystem: fs }), /PSD/);
});
test("file picker cannot open without a valid root", async () => {
  assert.equal(typeof tool.selectPsdFrame, "function"); const fs = fileSystem();
  await assert.rejects(tool.selectPsdFrame({ folder: null, localFileSystem: fs }), /folder/i); assert.equal(fs.pickerOptions.length, 0);
});
test("no active target gives exact warning without opening source", async () => {
  assert.equal(typeof tool.importPsdFrame, "function");
  const result = await tool.importPsdFrame({ fileEntry: frameFile, photoshop: { app: { documents: [], get activeDocument() { throw new Error("No document"); } } } });
  assert.deepEqual(tool.buildAddFrameToast(result), { message: "Create or open a page first.", type: "warning" });
});
test("all top-level source layers are duplicated into one editable named group", async () => {
  const h = importHost(), before = structuredClone(h.source.layers); assert.equal((await importFrame(h)).outcome, "success");
  assert.equal(h.target.layers.length, 2); assert.equal(h.target.layers[1], h.original); assert.equal(h.group.kind, "group"); assert.equal(h.group.name, "Classic Wedding Frame");
  assert.deepEqual(h.group.layers.map(layer => layer.name), ["Editable title", "Nested frame", "Adjustment"]); assert.deepEqual(h.source.layers, before);
  assert.equal(h.events.filter(event => event.type === "duplicate").length, 3); assert.equal(h.events.filter(event => event.type === "group").length, 1);
});
test("native duplication keeps nested groups and editable layer properties", async () => {
  const h = importHost(); await importFrame(h); const [text, nested, adjustment] = h.group.layers;
  assert.equal(text.kind, "text"); assert.equal(text.textItem.contents, "Wedding"); assert.equal(text.opacity, 80); assert.deepEqual(text.layerEffects, { stroke: true });
  assert.equal(nested.layers[0].kind, "smartObject"); assert.deepEqual(nested.layers[0].mask, { enabled: true });
  assert.equal(nested.layers[1].isClippingMask, true); assert.deepEqual(nested.layers[1].vectorMask, { enabled: true });
  assert.equal(adjustment.kind, "adjustment"); assert.equal(adjustment.blendMode, "multiply");
});
test("individual top-level transfers run bottom-to-top and group target copies in source order", async () => {
  const h = importHost(); assert.equal((await importFrame(h)).outcome, "success");
  const calls = h.events.filter(event => event.type === "duplicate");
  assert.deepEqual(calls.map(event => [event.method, event.name]), [
    ["layer", "Adjustment"], ["layer", "Nested frame"], ["layer", "Editable title"]
  ]);
  assert.ok(calls.every(event => event.destination === h.target));
  assert.deepEqual(h.group.layers.map(layer => layer.name), ["Editable title", "Nested frame", "Adjustment"]);
  assert.deepEqual(h.events.find(event => event.type === "group").fromLayers.map(layer => layer.name), ["Editable title", "Nested frame", "Adjustment"]);
});
test("failed individual transfer tries exactly one single-layer fallback and finishes import", async t => {
  const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  const h = importHost({ layerFailure: "Nested frame" }); assert.equal((await importFrame(h)).outcome, "success");
  assert.deepEqual(h.events.filter(event => event.type === "duplicate").map(event => [event.method, event.name]), [
    ["layer", "Adjustment"], ["layer", "Nested frame"], ["fallback", "Nested frame"], ["layer", "Editable title"]
  ]);
  assert.deepEqual(h.group.layers.map(layer => layer.name), ["Editable title", "Nested frame", "Adjustment"]);
  const diagnostic = logs.find(args => args[0] === "[ADD FRAME] Layer duplicate failed")[1];
  assert.equal(diagnostic.name, "Nested frame"); assert.equal(diagnostic.kind, "group"); assert.equal(diagnostic.id, 12);
  assert.equal(diagnostic.errorName, "PhotoshopError"); assert.match(diagnostic.errorMessage, /Native layer duplicate rejected/);
  assert.match(diagnostic.stack, /PhotoshopError/);
});
test("both transfer methods failing name the layer and native error, then roll back all copies", async t => {
  const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  const h = importHost({ layerFailure: "Nested frame", fallbackFailure: "Nested frame", layerPartial: true, fallbackPartial: true });
  const result = await importFrame(h);
  assert.equal(result.outcome, "error"); assert.match(result.message, /Could not import frame layer:\s*"Nested frame"/);
  assert.match(result.message, /Native single-layer fallback rejected/);
  assert.deepEqual(h.events.filter(event => event.type === "duplicate").map(event => event.name), ["Adjustment", "Nested frame", "Nested frame"]);
  assert.deepEqual(h.target.layers, [h.original]); assert.equal(h.group, undefined); assert.equal(h.closeCalls, 1);
  assert.equal(h.ps.app.activeDocument, h.target); assert.equal(h.events.findLast(event => event.type === "resume").commit, false);
  assert.ok(logs.some(args => args[0] === "[ADD FRAME] Layer fallback failed" && args[1].errorName === "PhotoshopError"));
});
test("a copy created before primary failure is removed before retrying that layer", async t => {
  t.mock.method(console, "error", () => {});
  const h = importHost({ layerFailure: "Nested frame", layerPartial: true });
  assert.equal((await importFrame(h)).outcome, "success");
  assert.deepEqual(h.target.layers.map(layer => layer.name), ["Classic Wedding Frame", "Album layer"]);
  assert.deepEqual(h.group.layers.map(layer => layer.name), ["Editable title", "Nested frame", "Adjustment"]);
  assert.deepEqual(h.events.filter(event => event.type === "delete").map(event => event.name), ["Nested frame"]);
});
test("a source-layer reference returned by primary is rejected and replaced by a valid target copy", async t => {
  t.mock.method(console, "error", () => {});
  const h = importHost({ invalidPrimary: "Nested frame" }); assert.equal((await importFrame(h)).outcome, "success");
  assert.equal(h.events.filter(event => event.type === "duplicate" && event.method === "fallback").length, 1);
  assert.equal(h.target.layers.length, 2); assert.equal(h.group.layers.length, 3);
  assert.ok(h.group.layers.every(layer => layer.document === h.target && !h.source.layers.includes(layer)));
});
test("locked Background layer transfers without unlocking or changing the source", async () => {
  const h = importHost({ background: true }), before = structuredClone(h.source.layers);
  assert.equal((await importFrame(h)).outcome, "success");
  assert.equal(h.events.find(event => event.type === "duplicate").name, "Background");
  assert.deepEqual(h.group.layers.map(layer => layer.name), ["Editable title", "Nested frame", "Adjustment", "Background"]);
  assert.equal(h.group.layers.at(-1).isBackgroundLayer, true); assert.equal(h.group.layers.at(-1).allLocked, true);
  assert.deepEqual(h.source.layers, before); assert.equal(h.closeCalls, 1); assert.equal(h.ps.app.documents.includes(h.target), true);
});
test("Background duplication failure names Background and preserves source locks", async t => {
  t.mock.method(console, "error", () => {});
  const h = importHost({ background: true, layerFailure: "Background", fallbackFailure: "Background" });
  const result = await importFrame(h); assert.equal(result.outcome, "error"); assert.match(result.message, /"Background"/);
  assert.match(result.message, /Native single-layer fallback rejected/); assert.equal(h.source.layers.at(-1).allLocked, true);
  assert.deepEqual(h.target.layers, [h.original]); assert.equal(h.closeCalls, 1); assert.equal(h.ps.app.activeDocument, h.target);
});
test("DEV progress logs identify the documents, count, transfers, group and completion", async t => {
  const logs = []; t.mock.method(console, "log", (...args) => logs.push(args));
  const h = importHost(); assert.equal((await importFrame(h)).outcome, "success");
  assert.ok(logs.some(args => args[0] === "[ADD FRAME] Source document:" && args[1].id === 30));
  assert.ok(logs.some(args => args[0] === "[ADD FRAME] Target document:" && args[1].id === 20));
  assert.ok(logs.some(args => args[0] === "[ADD FRAME] Top-level layer count:" && args[1] === 3));
  assert.equal(logs.filter(args => args[0].startsWith("[ADD FRAME] Duplicating:")).length, 3);
  assert.equal(logs.filter(args => args[0].startsWith("[ADD FRAME] Duplicated:")).length, 3);
  assert.ok(logs.some(args => args[0] === "[ADD FRAME] Creating group:" && args[1] === "Classic Wedding Frame"));
  assert.ok(logs.some(args => args[0] === "[ADD FRAME] Import completed."));
});
test("large group uniformly fits 80 percent and centers on target", async () => {
  const h = importHost(); await importFrame(h); const scale = h.events.find(event => event.type === "scale"); assert.equal(scale.x, 50); assert.equal(scale.y, 50);
  assert.deepEqual(h.group.bounds, { left: 100, top: 300, right: 900, bottom: 500 });
});
test("small group centers without enlargement", async () => {
  const h = importHost({ small: true }); await importFrame(h); assert.equal(h.events.some(event => event.type === "scale"), false);
  assert.deepEqual(h.group.bounds, { left: 400, top: 350, right: 600, bottom: 450 });
});
test("group stays selected, source closes unsaved and target is restored", async () => {
  const h = importHost(); await importFrame(h); assert.deepEqual(h.target.activeLayers, [h.group]); assert.equal(h.ps.app.activeDocument, h.target);
  assert.equal(h.closeCalls, 1); assert.equal(h.ps.app.documents.includes(h.source), false);
});
test("one history state covers the entire import", async () => {
  const h = importHost(); await importFrame(h); assert.deepEqual(h.events.find(event => event.type === "suspend").config, { documentID: 20, name: "Add PSD Frame" });
  assert.deepEqual(h.events.at(-1), { type: "resume", id: "history-id", commit: true }); assert.equal(h.events.filter(event => event.type === "modal").length, 1);
});
for (const flag of ["duplicateError", "groupError", "transformError", "selectError", "closeError", "empty", "openError"]) test(`${flag} rolls back target and closes owned source`, async () => {
  const h = importHost({ [flag]: true }), result = await importFrame(h); assert.equal(result.outcome, "error"); assert.ok(result.message);
  assert.deepEqual(h.target.layers, [h.original]); assert.deepEqual(h.target.activeLayers, [h.original]); assert.equal(h.ps.app.activeDocument, h.target);
  assert.equal(h.ps.app.documents.includes(h.source), false); assert.equal(h.events.findLast(event => event.type === "resume").commit, false);
});
for (const flag of ["alreadyOpen", "sameTarget"]) test(`${flag} refuses import without closing user documents`, async () => {
  const h = importHost({ [flag]: true }); assert.equal((await importFrame(h)).outcome, "error"); assert.equal(h.closeCalls, 0);
  assert.deepEqual(h.target.layers, [h.original]); assert.equal(h.ps.app.activeDocument, h.target);
});
test("ADD FRAME cancellation opens no native picker and imports nothing", async () => {
  const fs = fileSystem(); let dialogs = 0;
  const result = await tool.runAddFrame({ localFileSystem: fs, storage: storage(), showAddFrameDialog: async state => { dialogs++; assert.equal(state.folder, null); return { action: "cancel" }; } });
  assert.equal(result.outcome, "cancelled"); assert.equal(dialogs, 1); assert.equal(fs.folderPicks, 0); assert.equal(fs.pickerOptions.length, 0);
});
test("file picker cancellation reopens dialog; navigating elsewhere never changes root", async () => {
  const fs = fileSystem(), saved = storage(), root = folder(), h = importHost(); fs.nextFolder = root;
  await tool.changeFrameFolder({ localFileSystem: fs, storage: saved }); const token = saved.getItem(KEY); let step = 0;
  const result = await tool.runAddFrame({ localFileSystem: fs, storage: saved, photoshop: h.ps, showAddFrameDialog: async state => {
    assert.equal(state.folder, root); step++; if (step === 1) return { action: "select" }; fs.nextFile = frameFile; return { action: "select" };
  } });
  assert.equal(result.outcome, "success"); assert.equal(step, 2); assert.equal(saved.getItem(KEY), token);
  assert.equal(fs.folderPicks, 1); assert.equal(fs.pickerOptions.every(options => options.initialLocation === root), true);
});
