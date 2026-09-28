"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const tool = require("../src/tools/addAsset");
const categories = [
  ["png-mask", "PNG MASK", "mm_png_mask_folder_token", "Add PNG Mask"],
  ["png-text", "PNG TEXT", "mm_png_text_folder_token", "Add PNG Text"],
  ["clip-art", "CLIP ART", "mm_clip_art_folder_token", "Add Clip Art"]
];
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
function folder(name = "Assets") { return { name, nativePath: `F:/Wedding Resources/${name}`, isFolder: true, getEntries: async () => [] }; }
const png = { name: "Flower Corner 03.PNG", isFile: true, parent: folder("Elsewhere") };
function fileSystem() {
  const tokens = new Map(); let sequence = 0;
  return { tokens, options: [], folderCalls: 0, nextFolder: null, nextFile: null,
    async createPersistentToken(entry) { const token = `asset-${++sequence}`; tokens.set(token, entry); return token; },
    async getEntryForPersistentToken(token) { if (!tokens.has(token)) throw new Error("stale"); return tokens.get(token); },
    async getFolder() { this.folderCalls++; return this.nextFolder; },
    async getFileForOpening(options) { this.options.push(options); return this.nextFile; },
    async createSessionToken(entry) { assert.equal(entry, png); return "png-session-token"; }
  };
}
function host(options = {}) {
  let modal = false, active, selected, layer;
  const events = [], original = { id: 1, name: "Existing album group", kind: "group", layers: [{ id: 2, name: "Existing child" }] };
  const target = { id: 20, width: 1000, height: 800, layers: [original], get activeLayers() { return selected; } };
  active = target; selected = [original];
  const ps = { constants: { AnchorPosition: { MIDDLECENTER: "middle" }, ElementPlacement: { PLACEBEFORE: "before" } },
    app: { documents: [target], get activeDocument() { return active; }, set activeDocument(doc) { assert.equal(modal, true); active = doc; } },
    core: { async executeAsModal(fn, config) {
      events.push({ type: "modal", config }); modal = true;
      try { return await fn({ hostControl: {
        async suspendHistory(config) { events.push({ type: "suspend", config }); return "history"; },
        async resumeHistory(id, commit) { events.push({ type: "resume", id, commit });
          if (options.commitError && commit) throw new Error("Native history commit failed");
          if (options.rollbackError && !commit) throw new Error("Native history rollback failed");
          if (commit === false) { target.layers = [original]; original.layers = original.layers.filter(item => item.id === 2); selected = [original]; }
        }
      } }); } finally { modal = false; }
    } },
    action: { async batchPlay(commands) {
      assert.equal(modal, true); assert.equal(active, target);
      const command = commands[0]; events.push({ type: "action", command });
      if (command._obj === "placeEvent") {
        assert.equal(command.null._path, "png-session-token"); assert.equal(command.linked, false);
        layer = { id: 100, document: target, name: "Placed PNG", kind: "smartObject", isClippingMask: Boolean(options.clipped),
          bounds: { left: 0, top: 0, right: options.small ? 200 : 1600, bottom: options.small ? 100 : 400 },
          async scale(x, y, anchor) { assert.equal(modal, true); events.push({ type: "scale", x, y, anchor });
            if (options.transformError) throw new Error("Native transform failed");
            const b = this.bounds, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
            const w = (b.right - b.left) * x / 100, h = (b.bottom - b.top) * y / 100;
            this.bounds = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
          },
          async translate(x, y) { assert.equal(modal, true); events.push({ type: "translate", x, y });
            for (const edge of ["left", "right"]) this.bounds[edge] += x;
            for (const edge of ["top", "bottom"]) this.bounds[edge] += y;
          },
          async move(relative, where) { assert.equal(relative, original); assert.equal(where, "before"); events.push({ type: "move" });
            original.layers = original.layers.filter(item => item !== layer); target.layers = [layer, ...target.layers.filter(item => item !== layer)];
          },
          delete() { assert.equal(modal, true); events.push({ type: "delete" }); target.layers = target.layers.filter(item => item !== layer);
            original.layers = original.layers.filter(item => item !== layer); selected = [original]; }
        };
        if (options.nested) original.layers.unshift(layer); else target.layers.unshift(layer);
        selected = options.noSelection ? [original] : [layer];
        if (options.placeError) return [{ _obj: "error", result: -25922, message: "Native placement failed" }];
        return [{}];
      }
      assert.equal(command._obj, "select", "never open/save/rasterize/OCR/clip the PNG");
      if (options.selectError) return [{ _obj: "error", message: "Native selection failed" }];
      assert.equal(command._target[0]._id, layer.id); selected = [layer]; return [{}];
    } }
  };
  return { ps, target, original, events, get layer() { return layer; } };
}
const config = type => tool.ASSET_CONFIGS[type];
function importAsset(h, type = "png-mask") { return tool.importPngAsset({ config: config(type), fileEntry: png, photoshop: h.ps, localFileSystem: fileSystem() }); }

for (const [type, title, key, historyName] of categories) {
  test(`${title} has exact labels/key and first use opens no picker`, async () => {
    const fs = fileSystem(), saved = storage();
    assert.equal(config(type).title, title); assert.equal(config(type).selectLabel, `SELECT ${title}`);
    const result = await tool.resolveAssetFolder({ config: config(type), localFileSystem: fs, storage: saved });
    assert.equal(result.folder, null); assert.equal(fs.folderCalls, 0); assert.equal(saved.getItem(key), null);
  });
  test(`${title} stores/restores its own persistent root and preserves other settings`, async () => {
    const fs = fileSystem(), saved = storage({ mm_add_frame_folder_token: "frame", unrelated: "keep" }), root = folder(title); fs.nextFolder = root;
    await tool.changeAssetFolder({ config: config(type), localFileSystem: fs, storage: saved });
    const token = saved.getItem(key); assert.ok(token);
    assert.equal((await tool.resolveAssetFolder({ config: config(type), localFileSystem: fs, storage: saved })).folder, root);
    assert.equal(saved.getItem("mm_add_frame_folder_token"), "frame"); assert.equal(saved.getItem("unrelated"), "keep");
    assert.deepEqual([...saved.values.keys()].sort(), ["mm_add_frame_folder_token", "unrelated", key].sort());
  });
  test(`${title} folder change cancellation preserves its old root and token`, async () => {
    const fs = fileSystem(), saved = storage({ [key]: "old" }), root = folder();
    const result = await tool.changeAssetFolder({ config: config(type), localFileSystem: fs, storage: saved, currentFolder: root });
    assert.equal(result.folder, root); assert.equal(result.cancelled, true); assert.equal(saved.getItem(key), "old");
  });
  test(`${title} stale token clears only this category`, async () => {
    const fs = fileSystem(), initial = { mm_add_frame_folder_token: "frame", unrelated: "keep" };
    for (const [, , otherKey] of categories) initial[otherKey] = "stale";
    const saved = storage(initial); assert.equal((await tool.resolveAssetFolder({ config: config(type), localFileSystem: fs, storage: saved })).folder, null);
    assert.equal(saved.getItem(key), null); for (const otherKey of Object.keys(initial).filter(value => value !== key)) assert.equal(saved.getItem(otherKey), initial[otherKey]);
  });
  test(`${title} imports one embedded asset, names it and commits its own undo operation`, async () => {
    const h = host(), before = { ...png }; const result = await importAsset(h, type);
    assert.equal(result.outcome, "success"); assert.equal(h.layer.name, "Flower Corner 03"); assert.equal(h.layer.kind, "smartObject");
    assert.equal(h.layer.isClippingMask, false); assert.deepEqual(h.target.activeLayers, [h.layer]); assert.equal(h.ps.app.activeDocument, h.target);
    assert.deepEqual(h.events.find(event => event.type === "suspend").config, { documentID: 20, name: historyName });
    assert.equal(h.events.at(-1).commit, true); assert.equal(h.events.filter(event => event.type === "modal").length, 1);
    assert.equal(h.target.layers[1], h.original); assert.deepEqual(png, before);
  });
}
test("setting and changing all three roots leaves every other category and ADD FRAME intact", async () => {
  const fs = fileSystem(), saved = storage({ mm_add_frame_folder_token: "frame" });
  for (const [type] of categories) { fs.nextFolder = folder(type); await tool.changeAssetFolder({ config: config(type), localFileSystem: fs, storage: saved }); }
  const previous = Object.fromEntries(saved.values); fs.nextFolder = folder("Changed mask");
  await tool.changeAssetFolder({ config: config("png-mask"), localFileSystem: fs, storage: saved });
  assert.notEqual(saved.getItem("mm_png_mask_folder_token"), previous.mm_png_mask_folder_token);
  for (const key of ["mm_png_text_folder_token", "mm_clip_art_folder_token", "mm_add_frame_folder_token"]) assert.equal(saved.getItem(key), previous[key]);
});
for (const failure of ["unreadable", "token", "storage"]) test(`failed ${failure} folder change preserves old token`, async t => {
  t.mock.method(console, "warn", () => {});
  const fs = fileSystem(), saved = storage({ mm_png_mask_folder_token: "old" }); fs.nextFolder = folder();
  if (failure === "unreadable") fs.nextFolder.getEntries = async () => { throw new Error("denied"); };
  if (failure === "token") fs.createPersistentToken = async () => { throw new Error("token failure"); };
  if (failure === "storage") saved.setItem = () => { throw new Error("storage denied"); };
  await assert.rejects(tool.changeAssetFolder({ config: config("png-mask"), localFileSystem: fs, storage: saved }));
  assert.equal(saved.getItem("mm_png_mask_folder_token"), "old");
});
test("inaccessible remembered folder is cleared without automatically prompting", async () => {
  const fs = fileSystem(), saved = storage({ mm_png_text_folder_token: "root" });
  fs.tokens.set("root", { ...folder(), getEntries: async () => { throw new Error("denied"); } });
  assert.equal((await tool.resolveAssetFolder({ config: config("png-text"), localFileSystem: fs, storage: saved })).folder, null);
  assert.equal(saved.getItem("mm_png_text_folder_token"), null); assert.equal(fs.folderCalls, 0);
});
test("PNG picker starts at root with exact PNG/single-selection args; cancellation returns nothing", async () => {
  const fs = fileSystem(), root = folder();
  assert.equal(await tool.selectPngAsset({ config: config("png-mask"), folder: root, localFileSystem: fs }), null);
  assert.deepEqual(fs.options, [{ initialLocation: root, types: ["png"], allowMultiple: false }]);
  fs.nextFile = png; assert.equal(await tool.selectPngAsset({ config: config("png-mask"), folder: root, localFileSystem: fs }), png);
});
test("non-PNG files and missing roots are rejected before import", async () => {
  const fs = fileSystem(); fs.nextFile = { isFile: true, name: "image.jpg" };
  await assert.rejects(tool.selectPngAsset({ config: config("png-text"), folder: folder(), localFileSystem: fs }), /PNG/);
  await assert.rejects(tool.selectPngAsset({ config: config("png-text"), folder: null, localFileSystem: fs }), /folder/i);
});
test("no active document warns without opening native file picker", async () => {
  const fs = fileSystem(), saved = storage({ mm_png_mask_folder_token: "root" }), root = folder(); fs.tokens.set("root", root);
  let step = 0, warning;
  const result = await tool.runAddAsset({ config: config("png-mask"), localFileSystem: fs, storage: saved, photoshop: { app: { documents: [] } },
    showAssetDialog: async state => { if (++step === 2) { assert.equal(state.message, "Create or open a page first."); return { action: "cancel" }; } return { action: "select" }; },
    onResult: value => { warning = value; }
  });
  assert.equal(result.outcome, "cancelled"); assert.deepEqual(tool.buildAssetToast(warning), { message: "Create or open a page first.", type: "warning" }); assert.equal(fs.options.length, 0);
});
test("file cancel reopens config; navigation stays separate from root and target is captured before picker", async () => {
  const fs = fileSystem(), saved = storage({ mm_clip_art_folder_token: "root" }), root = folder(), h = host(); fs.tokens.set("root", root);
  const otherDoc = { id: 40 }; h.ps.app.documents.push(otherDoc); let step = 0;
  fs.getFileForOpening = async options => { fs.options.push(options); if (fs.options.length === 1) return null;
    // Simulate an active-document change outside the modal, during native selection.
    Object.defineProperty(h.ps.app, "activeDocument", { configurable: true, value: otherDoc, writable: true }); return png;
  };
  const result = await tool.runAddAsset({ config: config("clip-art"), localFileSystem: fs, storage: saved, photoshop: h.ps,
    showAssetDialog: async state => { assert.equal(state.folder, root); if (++step > 2) return { action: "cancel" }; return { action: "select" }; }
  });
  assert.equal(result.outcome, "success"); assert.equal(step, 2); assert.equal(h.layer.document, h.target);
  assert.equal(saved.getItem("mm_clip_art_folder_token"), "root"); assert.ok(fs.options.every(options => options.initialLocation === root));
});
test("oversized PNG uniformly fits 80 percent of canvas and centers", async () => {
  const h = host(); await importAsset(h); const scale = h.events.find(event => event.type === "scale");
  assert.equal(scale.x, 50); assert.equal(scale.y, 50); assert.deepEqual(h.layer.bounds, { left: 100, right: 900, top: 300, bottom: 500 });
});
test("small PNG centers without enlarging", async () => {
  const h = host({ small: true }); await importAsset(h); assert.equal(h.events.some(event => event.type === "scale"), false);
  assert.deepEqual(h.layer.bounds, { left: 400, right: 600, top: 350, bottom: 450 });
});
test("placement in selected group moves only the new PNG to an independent root layer", async () => {
  const h = host({ nested: true }); assert.equal((await importAsset(h)).outcome, "success");
  assert.equal(h.target.layers[0], h.layer); assert.deepEqual(h.original.layers.map(layer => layer.name), ["Existing child"]);
});
for (const [type, title] of categories) test(`${title} releases inherited clipping after moving the new asset to the top`, async () => {
  const h = host({ nested: true, clipped: true }); h.original.isClippingMask = true;
  assert.equal((await importAsset(h, type)).outcome, "success");
  assert.equal(h.target.layers[0], h.layer); assert.equal(h.layer.isClippingMask, false);
  assert.equal(h.original.isClippingMask, true); assert.deepEqual(h.original.layers.map(layer => layer.name), ["Existing child"]);
});
for (const flag of ["placeError", "transformError", "selectError", "noSelection"]) test(`${flag} removes partial PNG and restores original target selection`, async t => {
  const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  const h = host({ [flag]: true }), result = await importAsset(h);
  assert.equal(result.outcome, "error"); assert.match(result.message, /Could not add PNG mask\./);
  assert.deepEqual(h.target.layers, [h.original]); assert.deepEqual(h.target.activeLayers, [h.original]); assert.equal(h.ps.app.activeDocument, h.target);
  assert.equal(h.events.findLast(event => event.type === "resume").commit, false); assert.ok(logs.some(args => args.some(value => value instanceof Error)));
});
test("failed history commit removes the new asset instead of returning an error with it left behind", async t => {
  t.mock.method(console, "error", () => {});
  const h = host({ commitError: true }), result = await importAsset(h);
  assert.equal(result.outcome, "error"); assert.match(result.message, /Native history commit failed/);
  assert.deepEqual(h.target.layers, [h.original]); assert.deepEqual(h.target.activeLayers, [h.original]); assert.equal(h.ps.app.activeDocument, h.target);
});
test("failed rollback still cleans the partial layer and logs the original transform exception", async t => {
  const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  const h = host({ transformError: true, rollbackError: true }), result = await importAsset(h);
  assert.equal(result.outcome, "error"); assert.deepEqual(h.target.layers, [h.original]);
  assert.ok(h.events.some(event => event.type === "delete"));
  assert.ok(logs.some(args => args.some(value => value instanceof Error && value.message === "Native transform failed")));
});
