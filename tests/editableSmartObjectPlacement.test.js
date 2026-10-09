"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadPlacement(options = {}) {
  const events = [];
  const placeholder = { id: 10, kind: "pixel", bounds: { left: 0, top: 0, right: 100, bottom: 100 } };
  const album = { id: 1, layers: [placeholder], activeLayers: [placeholder] };
  const pixel = { id: 20, kind: "pixel", name: "Background" };
  const source = { id: 2, layers: [pixel], activeLayers: [pixel] };
  const documents = [album];
  const app = { activeDocument: album, documents };
  const copiedLayers = [];
  const sourceSmartObject = { id: 21, kind: "smartObject", name: "Background" };

  function makeCopy(id = 30) {
    const copy = {
      id, kind: "smartObject", document: album,
      bounds: { left: 0, top: 0, right: 200, bottom: 100 },
      async move(target, placement) {
        events.push(["move", target.id, placement]);
        if (options.failStep === "move") throw new Error("move failed");
      },
      async scale(x, y) {
        events.push(["scale", x, y]);
        if (options.failStep === "fit") throw new Error("fit failed");
      },
      async translate(x, y) { events.push(["translate", x, y]); },
      set isClippingMask(value) {
        events.push(["clip", value]);
        if (options.failStep === "clip") throw new Error("clip failed");
      },
      set name(value) {
        events.push(["rename", value]);
        if (options.failStep === "rename") throw new Error("rename failed");
      },
      async delete() {
        events.push(["delete-copy", id]);
        if (options.failStep === "delete") throw new Error("delete failed");
        album.layers = album.layers.filter(layer => layer.id !== id);
      }
    };
    copiedLayers.push(copy);
    album.layers.unshift(copy);
    return copy;
  }

  sourceSmartObject.duplicate = async target => {
    events.push(["duplicate", target.id]);
    if (options.failStep === "duplicate") throw new Error("duplicate failed");
    if (options.failStep === "partial-duplicate") {
      makeCopy(31);
      throw new Error("duplicate failed after insert");
    }
    if (options.extraCopy) {
      const first = makeCopy(31);
      first.document = undefined;
      makeCopy(33);
      return first;
    }
    const copy = makeCopy();
    app.activeDocument = target;
    return copy;
  };
  source.duplicateLayers = async (layers, target) => {
    events.push(["duplicate-fallback", layers[0].id, target.id]);
    if (options.failStep === "fallback") throw new Error("fallback failed");
    return [makeCopy(32)];
  };
  source.closeWithoutSaving = async () => {
    events.push(["close-without-saving", source.id]);
    if (app.activeDocument !== source) throw new Error("temporary source was not active for close");
    if (options.failStep === "close") throw new Error("close failed");
    const index = documents.indexOf(source);
    if (index >= 0) documents.splice(index, 1);
  };

  app.open = async file => {
    events.push(["open", file.name]);
    if (options.failStep === "open") throw new Error("open failed");
    if (options.alreadyOpen) {
      app.activeDocument = source;
      return source;
    }
    documents.push(source);
    app.activeDocument = source;
    return source;
  };
  if (options.alreadyOpen) documents.push(source);

  const executionContext = { hostControl: {
    async registerAutoCloseDocument(id) { events.push(["register", id]); },
    async unregisterAutoCloseDocument(id) { events.push(["unregister", id]); },
    async suspendHistory(args) { events.push(["suspend", args.documentID, args.name]); return "history-token"; },
    async resumeHistory(token) { events.push(["resume", token]); }
  } };
  const photoshop = {
    app,
    action: { async batchPlay(descriptors) {
      const command = descriptors[0];
      events.push(["batchPlay", command._obj]);
      if (command._obj === "select") source.activeLayers = [pixel];
      if (command._obj === "newPlacedLayer") {
        if (options.failStep === "convert") return [{ _obj: "error", message: "convert failed" }];
        source.layers = [sourceSmartObject];
        source.activeLayers = [sourceSmartObject];
      }
      return [{ _obj: "success" }];
    } },
    core: { async executeAsModal(callback) { return callback(executionContext); } },
    constants: {
      LayerKind: { SMARTOBJECT: "smartObject" },
      ElementPlacement: { PLACEBEFORE: "before" },
      AnchorPosition: { MIDDLECENTER: "center" }
    }
  };

  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/photoshop");
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "photoshop") return photoshop;
    if (request === "uxp") return { storage: { localFileSystem: { createSessionToken: async () => "unused" } } };
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[modulePath];
  let placement;
  try { placement = require(modulePath); }
  finally { Module._load = originalLoad; delete require.cache[modulePath]; }

  return { events, app, album, source, placeholder, copiedLayers, placement, executionContext };
}

const options = { coverFit: true, clipToPlaceholder: true, renameLayer: true };
const file = { name: "portrait.jpg" };

test("AUTO PHOTO FILL opens, converts and duplicates a source pixel layer without placeEvent", async () => {
  const h = loadPlacement();
  const result = await h.placement.placePhotoOnPlaceholder(file, h.placeholder, options, h.album, h.executionContext);
  assert.equal(result, h.copiedLayers[0]);
  assert.deepEqual(h.events.filter(event => event[0] === "batchPlay").map(event => event[1]), ["select", "newPlacedLayer"]);
  assert.equal(h.events.some(event => event[1] === "placeEvent"), false);
  assert.ok(h.events.some(event => event[0] === "open"));
  assert.ok(h.events.some(event => event[0] === "duplicate" && event[1] === h.album.id));
  assert.ok(h.events.some(event => event[0] === "close-without-saving"));
  assert.ok(h.events.some(event => event[0] === "register"));
  assert.ok(h.events.some(event => event[0] === "unregister"));
  assert.equal(h.app.activeDocument, h.album);
  assert.deepEqual(h.events.filter(event => ["move", "scale", "clip", "rename"].includes(event[0])).map(event => event[0]), ["move", "scale", "clip", "rename"]);
});

test("a source already open by the user is neither converted nor closed", async () => {
  const h = loadPlacement({ alreadyOpen: true });
  await assert.rejects(h.placement.placePhotoOnPlaceholder(file, h.placeholder, options, h.album, h.executionContext), /already open|close.*source/i);
  assert.equal(h.events.some(event => event[0] === "batchPlay"), false);
  assert.equal(h.events.some(event => event[0] === "close-without-saving"), false);
  assert.equal(h.events.some(event => event[0] === "register"), false);
  assert.equal(h.app.activeDocument, h.album);
  assert.equal(h.album.layers.length, 1);
});

for (const failStep of ["move", "fit", "clip", "rename"]) {
  test(`a ${failStep} failure deletes only the new album layer`, async () => {
    const h = loadPlacement({ failStep });
    await assert.rejects(h.placement.placePhotoOnPlaceholder(file, h.placeholder, options, h.album, h.executionContext), new RegExp(`${failStep} failed`));
    assert.deepEqual(h.album.layers.map(layer => layer.id), [h.placeholder.id]);
    assert.ok(h.events.some(event => event[0] === "close-without-saving"));
    assert.equal(h.app.activeDocument, h.album);
  });
}

test("a partial native duplicate is removed before the one-layer fallback", async () => {
  const h = loadPlacement({ failStep: "partial-duplicate" });
  const result = await h.placement.placePhotoOnPlaceholder(file, h.placeholder, options, h.album, h.executionContext);
  assert.equal(result.id, 32);
  assert.deepEqual(h.album.layers.map(layer => layer.id), [32, h.placeholder.id]);
  assert.ok(h.events.some(event => event[0] === "delete-copy" && event[1] === 31));
  assert.ok(h.events.some(event => event[0] === "duplicate-fallback"));
});

test("two native album copies are rejected and removed before fallback", async () => {
  const h = loadPlacement({ extraCopy: true });
  const result = await h.placement.placePhotoOnPlaceholder(file, h.placeholder, options, h.album, h.executionContext);
  assert.equal(result.id, 32);
  assert.deepEqual(h.album.layers.map(layer => layer.id), [32, h.placeholder.id]);
  assert.deepEqual(h.events.filter(event => event[0] === "delete-copy").map(event => event[1]), [33, 31]);
});

test("failed conversion leaves no album copy and closes the owned source", async () => {
  const h = loadPlacement({ failStep: "convert" });
  await assert.rejects(h.placement.placePhotoOnPlaceholder(file, h.placeholder, options, h.album, h.executionContext), /convert failed/);
  assert.deepEqual(h.album.layers.map(layer => layer.id), [h.placeholder.id]);
  assert.ok(h.events.some(event => event[0] === "close-without-saving"));
  assert.equal(h.app.activeDocument, h.album);
});

test("a temporary source close failure rolls back the album copy and leaves auto-close registered", async () => {
  const h = loadPlacement({ failStep: "close" });
  await assert.rejects(h.placement.placePhotoOnPlaceholder(file, h.placeholder, options, h.album, h.executionContext), /close failed/);
  assert.deepEqual(h.album.layers.map(layer => layer.id), [h.placeholder.id]);
  assert.ok(h.events.some(event => event[0] === "register"));
  assert.equal(h.events.some(event => event[0] === "unregister"), false);
  assert.equal(h.app.activeDocument, h.album);
});

test("runPlacement keeps album history grouped and excludes a failed item", async () => {
  const h = loadPlacement();
  const missing = { name: "bad.jpg" };
  const originalOpen = h.app.open;
  h.app.open = async entry => {
    if (entry === missing) throw new Error("source unavailable");
    return originalOpen(entry);
  };
  const result = await h.placement.runPlacement([
    { file: missing, layer: h.placeholder },
    { file, layer: h.placeholder }
  ], options);
  assert.equal(result.failedItems.length, 1);
  assert.equal(result.placedItems.length, 1);
  assert.equal(result.placedItems[0].file, file);
  assert.ok(h.events.some(event => event[0] === "suspend" && event[1] === h.album.id && event[2] === "FM Album Designing Tools - Auto Photo Fill"));
  assert.ok(h.events.some(event => event[0] === "resume"));
});

for (const failSecond of [false, true]) {
test(failSecond
  ? "a failed second photo leaves the first in place and still attempts the third"
  : "three photos place sequentially when target layers are stale while a source document is active", async () => {
  const events = [];
  const placeholders = [1, 2, 3].map(id => ({
    id, kind: "pixel", bounds: { left: 0, top: 0, right: 100, bottom: 100 }
  }));
  const actualAlbumLayers = [...placeholders];
  let visibleAlbumLayers = [...actualAlbumLayers];
  const album = { id: 1, get layers() {
    return app.activeDocument === album ? actualAlbumLayers : visibleAlbumLayers;
  } };
  let activeDocument = album;
  const app = {
    documents: [album],
    get activeDocument() { return activeDocument; },
    set activeDocument(document) {
      activeDocument = document;
      events.push(["active", document.id]);
      if (document === album) visibleAlbumLayers = [...actualAlbumLayers];
    },
    async open(entry) {
      assert.equal(this.activeDocument, album, "album must be active before each source opens");
      events.push(["snapshot", actualAlbumLayers.map(layer => layer.id)]);
      const number = Number(entry.name[0]);
      if (failSecond && number === 2) throw new Error("second source unavailable");
      const placeholderIndex = actualAlbumLayers.findIndex(layer => layer.id === number);
      actualAlbumLayers[placeholderIndex] = { ...actualAlbumLayers[placeholderIndex] };
      const pixel = { id: 100 + number, kind: "pixel" };
      const source = { id: 200 + number, layers: [pixel], activeLayers: [pixel] };
      source.closeWithoutSaving = async () => {
        events.push(["close", source.id]);
        this.documents = this.documents.filter(document => document !== source);
      };
      source.converted = {
        id: 300 + number, kind: "smartObject",
        async duplicate(target) {
          const copy = {
            id: 400 + number, kind: "smartObject", document: target,
            bounds: { left: 0, top: 0, right: 100, bottom: 100 },
            async move(placeholder) {
              assert.equal(app.activeDocument, album, "album must be active for move");
              assert.equal(placeholder, actualAlbumLayers.find(layer => layer.id === placeholder.id), "use the current album placeholder layer");
              events.push(["move", this.id, placeholder.id]);
            },
            async scale() {}, async translate() {},
            async delete() {
              const index = actualAlbumLayers.indexOf(this);
              if (index >= 0) actualAlbumLayers.splice(index, 1);
            }
          };
          actualAlbumLayers.unshift(copy);
          // Photoshop can keep the source active and expose a stale target collection.
          return copy;
        }
      };
      this.documents.push(source);
      this.activeDocument = source;
      return source;
    }
  };
  const photoshop = {
    app,
    action: { async batchPlay(descriptors) {
      if (descriptors[0]._obj === "newPlacedLayer") {
        app.activeDocument.activeLayers = [app.activeDocument.converted];
      }
      return [{ _obj: "success" }];
    } },
    core: { async executeAsModal(callback) { return callback({ hostControl: {
      async suspendHistory() { return "history"; }, async resumeHistory() {},
      async registerAutoCloseDocument() {}, async unregisterAutoCloseDocument() {}
    } }); } },
    constants: {
      LayerKind: { SMARTOBJECT: "smartObject" },
      ElementPlacement: { PLACEBEFORE: "before" },
      AnchorPosition: { MIDDLECENTER: "center" }
    }
  };
  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/photoshop");
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "photoshop") return photoshop;
    if (request === "uxp") return { storage: { localFileSystem: {} } };
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[modulePath];
  let placement;
  try { placement = require(modulePath); }
  finally { Module._load = originalLoad; delete require.cache[modulePath]; }

  const items = placeholders.map((layer, index) => ({ file: { name: `${index + 1}.jpg` }, layer }));
  const result = await placement.runPlacement(items, options);
  assert.equal(result.placedItems.length, failSecond ? 2 : 3);
  assert.equal(result.failedItems.length, failSecond ? 1 : 0);
  assert.deepEqual(actualAlbumLayers.filter(layer => layer.kind === "smartObject").map(layer => layer.id).sort(), failSecond ? [401, 403] : [401, 402, 403]);
  assert.deepEqual(events.filter(event => event[0] === "close").map(event => event[1]), failSecond ? [201, 203] : [201, 202, 203]);
  assert.deepEqual(events.filter(event => event[0] === "snapshot").map(event => event[1].length), failSecond ? [3, 4, 4] : [3, 4, 5]);
  assert.deepEqual(events.filter(event => event[0] === "move").map(event => event.slice(1)), failSecond ? [[401, 1], [403, 3]] : [[401, 1], [402, 2], [403, 3]]);
  assert.equal(app.activeDocument, album);
});
}
