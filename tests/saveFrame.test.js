"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { runSaveFrame, exportSelectedFrame, captureFrameSource, ensurePhotoFolder, reserveFrameFile, resolveSaveFrameRoot, changeSaveFrameRoot, buildSaveFrameToast } = require("../src/tools/saveFrame");
const KEY = "mm_save_frame_root_folder_token";
function folder(name, entries = []) {
  return { name, nativePath: `D:/Library/${name}`, isFolder: true, entries, created: [],
    async getEntries() { return this.entries; },
    async createFolder(child) { const entry = folder(child); this.entries.push(entry); this.created.push(child); return entry; },
    async createFile(name, options) {
      assert.equal(options.overwrite, false, "never overwrite library frames");
      if (this.entries.some(entry => entry.name.toLowerCase() === name.toLowerCase())) throw new Error("File exists");
      const entry = { name, isFile: true, async delete() { entry.deleted = true; } };
      this.entries.push(entry); return entry;
    } };
}
function memory(initial = {}, tokenMap = new Map()) {
  const data = new Map(Object.entries(initial));
  return { data, storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) },
    localFileSystem: { getEntryForPersistentToken: async token => { if (!tokenMap.has(token)) throw new Error("Stale"); return tokenMap.get(token); },
      createPersistentToken: async root => `token:${root.name}`, getNativePath: async root => root.nativePath } };
}
function host(options = {}) {
  let nextId = 100;
  const calls = [], source = { id: 1, width: 10800, height: 3600, resolution: 300, mode: "RGBColorMode", bitsPerChannel: 16, colorProfileName: "sRGB IEC61966-2.1", layers: [], activeLayers: [] };
  const other = { id: 9, layers: [], closeWithoutSaving() { throw new Error("Closed user document!"); } };
  const docs = [source, other], app = { documents: docs, activeDocument: source };
  function layer(name, children) {
    const entry = { id: nextId++, name, document: source, bounds: { left: 30, top: 70, right: 230, bottom: 570 },
      opacity: 73, blendMode: "multiply", isClippingMask: false, ...(children ? { layers: children } : {}),
      async duplicate(target) {
        calls.push(["duplicate", entry.name]);
        if (options.copyError) throw new Error("Native duplicate denied");
        const copy = { ...entry, id: nextId++, document: target, bounds: { ...entry.bounds },
          async delete() { target.layers.splice(target.layers.indexOf(copy), 1); },
          async translate(dx, dy) { for (const key of ["left", "right"]) copy.bounds[key] += dx; for (const key of ["top", "bottom"]) copy.bounds[key] += dy; },
          scale() { throw new Error("Export must not scale"); }, rasterize() { throw new Error("Export must not rasterize"); } };
        target.layers.unshift(copy);
        if (options.resetClipping) {
          let clipped = entry === base;
          Object.defineProperty(copy, "isClippingMask", { get: () => clipped, set(value) {
            clipped = value;
            if (!value) for (const upper of target.layers.slice(0, target.layers.indexOf(copy))) upper.isClippingMask = false;
          } });
        }
        if (options.shiftCopy) { copy.bounds.left += 10; copy.bounds.right += 10; copy.bounds.top -= 20; copy.bounds.bottom -= 20; }
        if (options.changeSelection) source.activeLayers = [source.layers[2]];
        if (options.partialCopy) throw new Error("Partial native duplicate");
        return copy;
      }, delete() { throw new Error("Deleted source layer!"); }, translate() { throw new Error("Moved source layer!"); },
      scale() { throw new Error("Scaled source!"); } };
    return entry;
  }
  const child = layer("Editable text"), group = layer("Selected frame group", [child]), base = layer("Selected base"), excluded = layer("Unselected market background");
  source.layers = [group, excluded, base]; source.activeLayers = [base, group];
  let temporary;
  docs.add = async creation => {
    calls.push(["create", creation]);
    if (options.createError) throw new Error("Native create denied");
    temporary = { id: 2, ...creation, layers: [], saveAs: { psd: async (file, settings, asCopy) => {
      calls.push(["save", file.name, settings, asCopy]);
      if (options.saveError) throw new Error("Native PSD write denied");
      file.savedLayers = temporary.layers.map(entry => entry.name);
      file.savedWidth = temporary.width;
      file.savedHeight = temporary.height;
      file.written = true;
    } }, async closeWithoutSaving() { calls.push(["close", 2]); if (options.closeError) throw new Error("Native close denied"); docs.splice(docs.indexOf(temporary), 1); temporary.closed = true; } };
    if (!options.noDomTrim) {
      temporary.trim = async (type, top, left, bottom, right) => {
        calls.push(["trim", type, { top, left, bottom, right }]);
        if (options.trimError) throw new Error("Native trim denied");
        let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
        for (const l of temporary.layers) {
          if (l.bounds) {
            minLeft = Math.min(minLeft, l.bounds.left);
            minTop = Math.min(minTop, l.bounds.top);
            maxRight = Math.max(maxRight, l.bounds.right);
            maxBottom = Math.max(maxBottom, l.bounds.bottom);
          }
        }
        if (Number.isFinite(minLeft) && Number.isFinite(maxRight) && maxRight > minLeft) {
          temporary.width = maxRight - minLeft;
          temporary.height = maxBottom - minTop;
        }
      };
    }
    const blank = { id: nextId++, name: "Layer 1", document: temporary, async delete() { calls.push(["delete-blank"]); temporary.layers.splice(temporary.layers.indexOf(blank), 1); } };
    temporary.layers = [blank]; docs.push(temporary); app.activeDocument = temporary;
    if (options.createPartialError) throw new Error("Create threw after opening document");
    if (options.returnSource) return source;
    return temporary;
  };
  source.duplicateLayers = async (items, target) => {
    calls.push(["fallback", items.map(item => item.name)]);
    if (options.copyError) throw new Error("Native fallback denied");
    assert.equal(items.length, 1);
    const wasPartial = options.partialCopy; options.partialCopy = false;
    try { return [await items[0].duplicate(target)]; } finally { options.partialCopy = wasPartial; }
  };
  const photoshop = { app, constants: { DocumentMode: { RGB: "RGBColorMode", CMYK: "CMYKColorMode" }, NewDocumentMode: { RGB: "RGBColorMode", CMYK: "CMYKColorMode" }, TrimType: { TRANSPARENT: "transparent" } },
    core: { executeAsModal: async callback => { calls.push(["modal"]); return callback({ hostControl: { registerAutoCloseDocument: async id => calls.push(["register", id]), unregisterAutoCloseDocument: async id => calls.push(["unregister", id]) } }); } },
    action: { batchPlay: async descriptors => { for (const descriptor of descriptors) {
      if (descriptor._obj === "trim") {
        calls.push(["trim-batchplay", descriptor]);
        if (options.trimError) throw new Error("Native trim denied");
        if (temporary) {
          let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
          for (const l of temporary.layers) {
            if (l.bounds) {
              minLeft = Math.min(minLeft, l.bounds.left);
              minTop = Math.min(minTop, l.bounds.top);
              maxRight = Math.max(maxRight, l.bounds.right);
              maxBottom = Math.max(maxBottom, l.bounds.bottom);
            }
          }
          if (Number.isFinite(minLeft) && Number.isFinite(maxRight) && maxRight > minLeft) {
            temporary.width = maxRight - minLeft;
            temporary.height = maxBottom - minTop;
          }
        }
      } else {
        const id = descriptor._target[0]._id, selected = [group, excluded, base, child].find(entry => entry.id === id);
        source.activeLayers = descriptor.selectionModifier ? [...source.activeLayers, selected] : [selected];
        calls.push(["select", id]);
      }
    } return [{}]; } } };
  return { source, group, base, child, excluded, layer, photoshop, calls, get temporary() { return temporary; } };
}
const exportArgs = h => ({ sourceSnapshot: captureFrameSource(h.photoshop.app), root: folder("Frames"), photoCount: 3, photoshop: h.photoshop });

test("no document stops before dialog or picker with the requested warning", async () => {
  const result = await runSaveFrame({ photoshop: { app: { documents: [] } }, showSaveFrameDialog: () => assert.fail("Should not open dialog") });
  assert.equal(result.message, "Open a PSD first."); assert.equal(buildSaveFrameToast(result).type, "warning");
});
test("no selected layers stops before configuration", async () => {
  const h = host(); h.source.activeLayers = [];
  const result = await runSaveFrame({ photoshop: h.photoshop, showSaveFrameDialog: () => assert.fail("Should not continue") });
  assert.equal(result.message, "Select one or more frame layers first.");
});
test("first use does not open folder picker automatically", async () => {
  const h = host(), m = memory(); let calls = 0;
  m.localFileSystem.getFolder = () => assert.fail("Unexpected native picker");
  const result = await runSaveFrame({ photoshop: h.photoshop, ...m, showSaveFrameDialog: args => { calls++; assert.equal(args.folder, null); assert.equal(args.photoCount, 3); return { action: "cancel" }; } });
  assert.equal(result.outcome, "cancelled"); assert.equal(calls, 1); assert.equal(m.data.size, 0);
});
test("remembered SAVE FRAME root restores without affecting other keys", async () => {
  const root = folder("Frames"), m = memory({ [KEY]: "saved", mm_add_frame_folder_token: "old", mm_png_text_folder_token: "text" }, new Map([["saved", root]]));
  assert.equal((await resolveSaveFrameRoot(m)).folder, root); assert.equal(m.data.get("mm_add_frame_folder_token"), "old"); assert.equal(m.data.get("mm_png_text_folder_token"), "text");
});
test("stale token clears only SAVE FRAME root", async () => {
  const m = memory({ [KEY]: "stale", mm_png_mask_folder_token: "mask", mm_clip_art_folder_token: "art" });
  assert.equal((await resolveSaveFrameRoot(m)).folder, null); assert.equal(m.data.has(KEY), false); assert.equal(m.data.size, 2);
});
test("unreadable remembered root clears only its own token", async () => {
  const root = folder("Frames"); root.getEntries = async () => { throw new Error("Access denied"); };
  const m = memory({ [KEY]: "saved", other: "keep" }, new Map([["saved", root]]));
  assert.equal((await resolveSaveFrameRoot(m)).folder, null); assert.equal(m.data.get("other"), "keep");
});
test("SET FOLDER saves a dedicated persistent token", async () => {
  const m = memory({ mm_add_frame_folder_token: "keep" }), root = folder("Frames");
  const result = await changeSaveFrameRoot({ ...m, promptForFolder: async () => root });
  assert.equal(result.folder, root); assert.equal(m.data.get(KEY), "token:Frames"); assert.equal(m.data.get("mm_add_frame_folder_token"), "keep");
});
test("cancelled CHANGE FOLDER preserves the previous root/token", async () => {
  const m = memory({ [KEY]: "old" }), root = folder("Old");
  const result = await changeSaveFrameRoot({ ...m, currentFolder: root, promptForFolder: async () => null });
  assert.equal(result.folder, root); assert.equal(m.data.get(KEY), "old");
});
test("persistent-token failure restores old token", async () => {
  const m = memory({ [KEY]: "old" }); m.localFileSystem.createPersistentToken = async () => { throw new Error("Denied"); };
  await assert.rejects(changeSaveFrameRoot({ ...m, promptForFolder: async () => folder("New") })); assert.equal(m.data.get(KEY), "old");
});
test("CHANGE FOLDER installs a new token only after readable selection", async () => {
  const m = memory({ [KEY]: "old" }), root = folder("New");
  await changeSaveFrameRoot({ ...m, promptForFolder: async () => root }); assert.equal(m.data.get(KEY), "token:New");
  root.getEntries = async () => { throw new Error("Unreadable"); };
  await assert.rejects(changeSaveFrameRoot({ ...m, promptForFolder: async () => root })); assert.equal(m.data.get(KEY), "token:New");
});
for (const count of [1, 3, 5, 12]) test(`${count} PHOTOS maps to its own auto-created folder`, async () => {
  const root = folder("Frames"), destination = await ensurePhotoFolder(root, count);
  assert.equal(destination.name, `${count} PHOTOS`); assert.deepEqual(root.created, [`${count} PHOTOS`]);
});
test("existing destination is reused", async () => {
  const destination = folder("3 PHOTOS"), root = folder("Frames", [destination]);
  assert.equal(await ensurePhotoFolder(root, 3), destination); assert.equal(root.created.length, 0);
});
test("invalid count and a file occupying a category name fail safely", async () => {
  for (const count of [0, 13, 2.5, NaN]) await assert.rejects(ensurePhotoFolder(folder("Frames"), count));
  await assert.rejects(ensurePhotoFolder(folder("Frames", [{ name: "3 PHOTOS", isFile: true }]), 3));
});
test("next filename scans highest PSD serial, ignores nonfiles/unrelated entries, pads 3 digits", async () => {
  const destination = folder("3 PHOTOS", [{ name: "Frame 001.psd", isFile: true }, { name: "FRAME 003.PSD", isFile: true }, { name: "Frame 099.jpg", isFile: true }, { name: "Frame 999.psd", isFolder: true }]);
  assert.equal((await reserveFrameFile(destination)).name, "Frame 004.psd");
});
test("empty categories start independently at Frame 001.psd", async () => {
  const root = folder("Frames"), first = await ensurePhotoFolder(root, 3), other = await ensurePhotoFolder(root, 5);
  assert.equal((await reserveFrameFile(first)).name, "Frame 001.psd"); assert.equal((await reserveFrameFile(first)).name, "Frame 002.psd"); assert.equal((await reserveFrameFile(other)).name, "Frame 001.psd");
});
test("numbering expands beyond 999 without truncation", async () => {
  assert.equal((await reserveFrameFile(folder("Frames", [{ name: "Frame 999.psd", isFile: true }]))).name, "Frame 1000.psd");
});
test("sequence scanning failure propagates without reserving a file", async () => {
  const destination = folder("Frames"); destination.getEntries = async () => { throw new Error("Read denied"); };
  await assert.rejects(reserveFrameFile(destination), /Read denied/); assert.equal(destination.entries.length, 0);
});
test("selection normalizes to source stack order and excludes selected descendants of groups", () => {
  const h = host(); h.source.activeLayers = [h.base, h.child, h.group];
  assert.deepEqual(captureFrameSource(h.photoshop.app).layers.map(entry => entry.name), ["Selected frame group", "Selected base"]);
});
test("selected child alone exports without unselected parent or siblings", async () => {
  const h = host(); h.source.activeLayers = [h.child]; const result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "success"); assert.deepEqual(h.temporary.layers.map(entry => entry.name), ["Editable text"]);
});
test("export trims transparent canvas to visible content bounds, not fixed source dimensions", async () => {
  const h = host(), result = await exportSelectedFrame(exportArgs(h)); assert.equal(result.outcome, "success");
  const creation = h.calls.find(entry => entry[0] === "create")[1];
  assert.equal(creation.width, 10800); assert.equal(creation.height, 3600); assert.equal(creation.resolution, 300); assert.equal(creation.mode, "RGBColorMode"); assert.equal(creation.depth, 16); assert.equal(creation.profile, "sRGB IEC61966-2.1"); assert.equal(creation.fill, "transparent");
  const trimCall = h.calls.find(entry => entry[0] === "trim");
  assert.ok(trimCall, "must call native trim transparent pixels");
  assert.equal(trimCall[1], "transparent");
  assert.deepEqual(trimCall[2], { top: true, bottom: true, left: true, right: true });
  const trimIndex = h.calls.findIndex(entry => entry[0] === "trim");
  const saveIndex = h.calls.findIndex(entry => entry[0] === "save");
  assert.ok(trimIndex > 0 && trimIndex < saveIndex, "trim must execute after layer duplicate and before save");
  assert.notEqual(h.temporary.width, h.source.width);
  assert.notEqual(h.temporary.height, h.source.height);
  assert.equal(h.temporary.width, 200);
  assert.equal(h.temporary.height, 500);
  assert.equal(h.source.width, 10800);
  assert.equal(h.source.height, 3600);
});
test("batchPlay trim fallback trims canvas when DOM doc.trim is unavailable", async () => {
  const h = host({ noDomTrim: true }); const result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "success");
  const batchTrim = h.calls.find(entry => entry[0] === "trim-batchplay");
  assert.ok(batchTrim, "batchPlay trim fallback must be called");
  assert.equal(batchTrim[1]._obj, "trim");
  assert.equal(batchTrim[1].trimBasedOn._value, "transparency");
  assert.equal(batchTrim[1].top, true); assert.equal(batchTrim[1].bottom, true); assert.equal(batchTrim[1].left, true); assert.equal(batchTrim[1].right, true);
  assert.notEqual(h.temporary.width, h.source.width); assert.notEqual(h.temporary.height, h.source.height);
  assert.equal(h.temporary.width, 200); assert.equal(h.temporary.height, 500);
});
test("CMYK export preserves practical source mode", async () => {
  const h = host(); h.source.mode = "CMYKColorMode"; await exportSelectedFrame(exportArgs(h));
  assert.equal(h.calls.find(entry => entry[0] === "create")[1].mode, "CMYKColorMode");
});
test("only selected native layers duplicate individually, bottom to top; group hierarchy survives", async () => {
  const h = host(); await exportSelectedFrame(exportArgs(h));
  assert.deepEqual(h.calls.filter(entry => entry[0] === "duplicate").map(entry => entry[1]), ["Selected base", "Selected frame group"]);
  assert.deepEqual(h.temporary.layers.map(entry => entry.name), ["Selected frame group", "Selected base"]);
  assert.equal(h.temporary.layers[0].layers[0].name, "Editable text"); assert.equal(h.temporary.layers[0].opacity, 73); assert.equal(h.temporary.layers[0].blendMode, "multiply");
});
test("copy positions remain at source coordinates with no fitting/cropping", async () => {
  const h = host({ shiftCopy: true }); await exportSelectedFrame(exportArgs(h));
  assert.deepEqual(h.temporary.layers[0].bounds, h.group.bounds); assert.deepEqual(h.temporary.layers[1].bounds, h.base.bounds);
});
test("successful export uses layered PSD saveAs copy, closes temp, restores source", async () => {
  const h = host(), before = [...h.source.layers], selection = [...h.source.activeLayers], result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.message, "Saved frame: 3 PHOTOS / Frame 001.psd"); assert.equal(buildSaveFrameToast(result).type, "success");
  const save = h.calls.find(entry => entry[0] === "save"); assert.deepEqual(save.slice(1), ["Frame 001.psd", { layers: true, embedColorProfile: true }, true]);
  assert.equal(h.temporary.closed, true); assert.equal(h.photoshop.app.activeDocument, h.source); assert.deepEqual(h.source.layers, before); assert.deepEqual(h.source.activeLayers, selection);
});
test("native duplication changes source selection; original selected IDs restore", async () => {
  const h = host({ changeSelection: true }), ids = h.source.activeLayers.map(entry => entry.id); await exportSelectedFrame(exportArgs(h));
  assert.deepEqual(h.source.activeLayers.map(entry => entry.id), ids);
});
test("partial Layer.duplicate failure removes only partial copies before single-item fallback", async () => {
  const h = host({ partialCopy: true }), result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "success"); assert.equal(h.temporary.layers.length, 2); assert.equal(h.calls.filter(entry => entry[0] === "fallback").length, 2);
});
for (const stage of ["createError", "copyError", "trimError", "saveError", "createPartialError"]) test(`${stage}: closes only owned temp, deletes own unfinished file, source stays intact`, async () => {
  const h = host({ [stage]: true }), args = exportArgs(h), before = [...h.source.layers], selected = [...h.source.activeLayers];
  const result = await exportSelectedFrame(args);
  assert.equal(result.outcome, "error"); assert.match(result.message, /Could not save frame PSD\./);
  assert.equal(h.photoshop.app.documents.length, 2); assert.equal(h.photoshop.app.activeDocument, h.source); assert.deepEqual(h.source.layers, before); assert.deepEqual(h.source.activeLayers, selected);
  assert.equal(args.root.entries[0].entries[0].deleted, true);
});
test("trim preserves all selected layers, groups, opacity, and blend modes as editable layers", async () => {
  const h = host(); const result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "success");
  assert.equal(h.temporary.layers.length, 2);
  assert.equal(h.temporary.layers[0].name, "Selected frame group");
  assert.equal(h.temporary.layers[0].layers[0].name, "Editable text");
  assert.equal(h.temporary.layers[0].opacity, 73);
  assert.equal(h.temporary.layers[0].blendMode, "multiply");
  assert.equal(h.temporary.layers[1].name, "Selected base");
  assert.equal(h.source.layers.length, 3);
});
test("source closed before modal export is rejected without creating a document", async () => {
  const h = host(), args = exportArgs(h); h.photoshop.app.documents.splice(0, 1);
  assert.equal((await exportSelectedFrame(args)).outcome, "error"); assert.equal(h.calls.some(entry => entry[0] === "create"), false);
});
test("a returned pre-existing document is never edited or closed", async () => {
  const h = host({ returnSource: true }); const result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "error"); assert.equal(h.source.layers.length, 3); assert.equal(h.photoshop.app.documents.some(entry => entry.id === 1), true);
});
test("folder creation error does not open a temporary document", async () => {
  const h = host(), args = exportArgs(h); args.root.createFolder = async () => { throw new Error("Folder creation denied"); };
  assert.equal((await exportSelectedFrame(args)).outcome, "error"); assert.equal(h.calls.some(entry => entry[0] === "create"), false);
});
test("configuration retains count across root change and stops after successful save", async () => {
  const h = host(), root = folder("Frames"), m = memory(), choices = [{ action: "set-folder", photoCount: 5 }, { action: "save", photoCount: 5 }];
  m.localFileSystem.getFolder = async () => root; let shows = 0;
  const result = await runSaveFrame({ photoshop: h.photoshop, ...m, showSaveFrameDialog: args => { shows++; if (shows === 2) { assert.equal(args.folder, root); assert.equal(args.photoCount, 5); } assert.ok(choices.length); return choices.shift(); } });
  assert.equal(result.outcome, "success"); assert.equal(result.message, "Saved frame: 5 PHOTOS / Frame 001.psd"); assert.equal(shows, 2);
});
test("SAVE without root reports warning and keeps configuration usable", async () => {
  const h = host(), m = memory(), choices = [{ action: "save", photoCount: 3 }, { action: "cancel" }], reports = [];
  await runSaveFrame({ photoshop: h.photoshop, ...m, onResult: result => reports.push(result), showSaveFrameDialog: () => { assert.ok(choices.length); return choices.shift(); } });
  assert.equal(reports[0].message, "Set a frame library folder first."); assert.equal(h.calls.length, 0);
});
test("save errors remain visible for retry while releasing the temp document", async () => {
  const h = host({ saveError: true }), root = folder("Frames"), m = memory({ [KEY]: "root" }, new Map([["root", root]])); let shows = 0;
  const result = await runSaveFrame({ photoshop: h.photoshop, ...m, showSaveFrameDialog: args => { if (++shows === 1) return { action: "save", photoCount: 3 }; assert.match(args.message, /Native PSD write denied/); assert.equal(h.photoshop.app.documents.length, 2); return { action: "cancel" }; } });
  assert.equal(result.outcome, "cancelled"); assert.equal(m.data.get(KEY), "root");
});
test("cleanup failure retains the original native PSD error and restores source focus", async () => {
  const h = host({ saveError: true, closeError: true }), result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "error"); assert.equal(result.error.message, "Native close denied");
  assert.equal(result.error.cause.message, "Native PSD write denied"); assert.equal(h.photoshop.app.activeDocument, h.source);
});
test("clipping repair restores lower base before upper clipping layers and verifies final flags", async () => {
  const h = host({ resetClipping: true }); h.group.isClippingMask = true; h.source.layers = [h.group, h.base, h.excluded];
  const result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "success"); assert.equal(h.temporary.layers[0].isClippingMask, true); assert.equal(h.temporary.layers[1].isClippingMask, false);
});
test("a selected clipped layer without its base exports standalone rather than clipping to unrelated selected content", async () => {
  const h = host(); h.group.isClippingMask = true; // The unselected market background is its actual base.
  const result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "success"); assert.equal(h.temporary.layers[0].isClippingMask, false);
});
test("mixed parent/child selection cannot rebind a clipped layer to a promoted child", async () => {
  const h = host(), upper = h.layer("Clipped A"), middleChild = h.layer("Normal child X"), middle = h.layer("Clipped group B", [middleChild]);
  upper.isClippingMask = true; middle.isClippingMask = true;
  h.source.layers = [upper, middle, h.base]; h.source.activeLayers = [upper, middleChild, h.base];
  const result = await exportSelectedFrame(exportArgs(h));
  assert.equal(result.outcome, "success"); assert.deepEqual(h.temporary.layers.map(entry => entry.name), ["Clipped A", "Normal child X", "Selected base"]);
  assert.equal(h.temporary.layers[0].isClippingMask, false); assert.equal(upper.isClippingMask, true);
});
