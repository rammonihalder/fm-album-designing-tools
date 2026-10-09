"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runAlbumQuickEdit } = require("../src/tools/albumQuickEdit");

function smart(id, contentId, extra = {}) {
  return { id, name: `Photo ${id}`, kind: "smartObject", contentId, linked: false, ...extra };
}

function makeHost({ selected = [smart(11, "unique-11")], other = [], failSave = new Set(), failOpen = new Set(), openErrorAfterCreate = new Set(), throwOpenAfterCreate = new Set(), extraOpenDoc = new Set(), failClose = new Set(), existingOpen = new Set(), ambiguousInner = new Set(), cancelAfterSave = false, cancelAfterSet = false, strictCancelledSelect = false } = {}) {
  const events = [];
  const group = { id: 8, kind: "group", name: "Album photos", layers: [...selected, ...other] };
  const album = { id: 1, name: "Album.psd", layers: [group, { id: 2, kind: "normal", name: "Background" }], activeLayers: [...selected] };
  const documents = [album];
  let cancelled = false;
  let modalDepth = 0;
  let rootModal = 0;
  const preexisting = new Map();
  for (const id of existingOpen) {
    const doc = { id: 900 + id, name: `Photo ${id}.psb`, layers: [{ id: 2000 + id, kind: "normal", name: "Image" }], activeLayers: [] };
    documents.push(doc);
    preexisting.set(id, doc);
  }
  let activeDocument = album;
  const app = {
    documents,
    get activeDocument() { return activeDocument; },
    set activeDocument(doc) { activeDocument = doc; events.push(`activate:${doc.id}`); }
  };
  const flatten = layers => layers.flatMap(layer => [layer, ...flatten(layer.layers || [])]);
  const selectedId = () => activeDocument.activeLayers[0]?.id;
  const action = {
    async batchPlay(commands) {
      const command = commands[0];
      if (command._obj === "get") {
        events.push(`get:${command._target[0]._property}`);
        const layerId = command._target.find(ref => ref._ref === "layer")._id;
        const layer = flatten(album.layers).find(item => item.id === layerId);
        if (!layer) return [{ _obj: "error", message: "missing layer" }];
        return [{ smartObject: { linked: layer.linked }, smartObjectMore: { ID: layer.contentId } }];
      }
      if (command._obj === "select") {
        if (strictCancelledSelect && cancelled && rootModal === 1) throw new Error("batchPlay rejected after cancellation");
        const id = command._target[0]._id;
        const layer = flatten(activeDocument.layers).find(item => item.id === id);
        if (!layer) return [{ _obj: "error", message: "missing selection" }];
        if (command.selectionModifier) activeDocument.activeLayers.push(layer);
        else activeDocument.activeLayers = [layer];
        events.push(`select:${activeDocument.id}:${id}`);
        return [{}];
      }
      if (command._obj === "make") {
        const kind = { brightnessEvent: "brightnessContrast", levels: "levels", curves: "curves" }[command.using?.type?._obj];
        if (!kind || activeDocument === album) return [{ _obj: "error", message: "wrong adjustment target" }];
        const layer = { id: 4000 + activeDocument.id, name: "New Adjustment", kind, isClippingMask: false };
        const at = activeDocument.layers.findIndex(item => item.id === selectedId());
        activeDocument.layers.splice(at, 0, layer);
        activeDocument.activeLayers = [layer];
        events.push(`make:${command.using.type._obj}`);
        return [{}];
      }
      if (command._obj === "set") {
        events.push(`set:${command.to?._obj}`);
        return [{}];
      }
      if (command._obj === "placedLayerEditContents") {
        const id = selectedId();
        events.push(`open:${id}`);
        if (failOpen.has(id)) return [{ _obj: "error", message: "open failed" }];
        if (existingOpen.has(id)) {
          app.activeDocument = preexisting.get(id);
          return [{}];
        }
        const photo = { id: 1000 + id, kind: "normal", name: "Image" };
        const inner = {
          id: 100 + id, name: `Photo ${id}.psb`, layers: ambiguousInner.has(id) ? [photo, { id: 3000 + id, kind: "normal", name: "Other image" }] : [photo], activeLayers: [photo], selection: { bounds: null },
          async save() { events.push(`save:${id}`); if (failSave.has(id)) throw new Error("save failed"); },
          async close(option) { events.push(`close:${id}:${option}`); if (failClose.has(id)) throw new Error("close failed"); documents.splice(documents.indexOf(inner), 1); app.activeDocument = album; }
        };
        documents.push(inner);
        if (extraOpenDoc.has(id)) {
          const extra = { id: 600 + id, name: `Unexpected ${id}.psb`, layers: [], activeLayers: [],
            async close(option) { events.push(`close-extra:${id}:${option}`); documents.splice(documents.indexOf(extra), 1); } };
          documents.push(extra);
        }
        app.activeDocument = inner;
        if (throwOpenAfterCreate.has(id)) throw new Error("open threw after creating PSB");
        return openErrorAfterCreate.has(id) ? [{ _obj: "error", message: "open reported failure" }] : [{}];
      }
      return [{}];
    }
  };
  const hostControl = {
    async registerAutoCloseDocument(id) { events.push(`register:${id}`); },
    async unregisterAutoCloseDocument(id) { events.push(`unregister:${id}`); },
    async suspendHistory() { return { doc: activeDocument, layers: activeDocument.layers.slice(), selected: activeDocument.activeLayers.slice() }; },
    async resumeHistory(snapshot, commit) {
      if (!commit) { snapshot.doc.layers = snapshot.layers; snapshot.doc.activeLayers = snapshot.selected; }
    }
  };
  return {
    album, events, cancel: () => { cancelled = true; },
    photoshop: { app, action, constants: { LayerKind: { SMARTOBJECT: "smartObject", NORMAL: "normal", BRIGHTNESSCONTRAST: "brightnessContrast", LEVELS: "levels", CURVES: "curves" }, SaveOptions: { DONOTSAVECHANGES: "discard" } }, core: { executeAsModal: async fn => {
      if (modalDepth === 0) rootModal++;
      modalDepth++;
      try { return await fn({ hostControl, get isCancelled() { return (cancelled && rootModal === 1) || (cancelAfterSave && events.some(value => value.startsWith("save:")) && rootModal === 1) || (cancelAfterSet && events.some(value => value.startsWith("set:")) && rootModal === 1); } }); }
      finally { modalDepth--; }
    } } }
  };
}

const correction = async (kind, { photoshop }) => {
  assert.equal(photoshop.app.activeDocument.name.endsWith(".psb"), true);
  return { success: true, outcome: "applied" };
};

test("QUICK EDIT follows CREATE ALBUM with four static, visible controls", () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const html = fs.readFileSync(path.join(root, manifest.main), "utf8");
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(html, /<script src="main\.js"><\/script>/);
  const createStart = html.indexOf('<section class="create-album-section"');
  const createEnd = html.indexOf('</section>', createStart);
  const quickStart = html.indexOf('<section class="quick-edit-section"');
  const footerStart = html.indexOf('<div class="plugin-footer"');
  assert.ok(createStart > html.indexOf('<section class="tool-section"'));
  assert.ok(createEnd < quickStart && quickStart < footerStart);
  assert.equal((html.match(/class="quick-edit-section"/g) || []).length, 1);
  const section = html.match(/<section class="quick-edit-section"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section, "QUICK EDIT must be inside the manifest panel");
  assert.doesNotMatch(section, /quickEditToggle|quickEditContent|quickEditChevron|aria-expanded/);
  const rowStarts = Array.from(section.matchAll(/<div class="quick-edit-row">/g), match => match.index);
  const rows = rowStarts.map((start, index) => section.slice(start, rowStarts[index + 1] ?? section.indexOf('id="quickEditReport"')));
  assert.equal(rows.length, 2, "four controls must occupy two visible rows");
  assert.deepEqual(rows.map(row => Array.from(row.matchAll(/id="(quick\w+Btn)"/g), match => match[1])), [
    ["quickBrightnessBtn", "quickLevelsBtn"], ["quickCurvesBtn", "quickWhiteBalanceBtn"]
  ]);
  const tiles = [
    ["quickBrightnessBtn", "Auto Brightness", "Brightness + Contrast"],
    ["quickLevelsBtn", "Auto Levels", "Tonal balance"],
    ["quickCurvesBtn", "Auto Curves", "Curves correction"],
    ["quickWhiteBalanceBtn", "White Balance", "Coming soon"]
  ];
  for (let index = 0; index < tiles.length; index++) {
    const [id, title, subtitle] = tiles[index];
    const start = section.indexOf(`id="${id}"`);
    const end = index + 1 < tiles.length ? section.indexOf(`id="${tiles[index + 1][0]}"`) : section.indexOf('id="quickEditReport"');
    const tile = section.slice(start, end);
    assert.ok(start >= 0 && end > start, `${id} must have its own tile`);
    assert.ok(tile.includes(`<span class="quick-edit-title">${title}</span>`), `${id} title is correct`);
    assert.ok(tile.includes(`<span class="quick-edit-subtitle">${subtitle}</span>`), `${id} subtitle is correct`);
  }
  assert.doesNotMatch(section, /class="quick-edit-section"[^>]*hidden/);
  assert.match(css, /\.panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.quick-edit-grid\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.quick-edit-row\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(css, /\.quick-edit-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.quick-edit-action\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.quick-edit-action\s*\{[^}]*height:\s*56px/s);
  assert.match(css, /\.quick-edit-action:active\s*\{/);
  assert.match(css, /\.quick-edit-action\.quick-edit-unavailable[^{]*\{[^}]*background:/s);
  assert.doesNotMatch(css, /\.quick-edit-content\[hidden\]|\.quick-edit-toggle\[aria-expanded/);
  assert.match(css, /@media\s*\(max-width:\s*290px\)[\s\S]*?\.quick-edit-row\s*\{\s*flex-direction:\s*column/s);
  for (const id of ["quickBrightnessBtn", "quickLevelsBtn", "quickCurvesBtn"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
    assert.doesNotMatch(section.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] || "", /\bhidden\b|aria-disabled="true"/);
    assert.ok(main.includes(`${id}: $("${id}")`), `${id} must initialize from its panel element`);
  }
  assert.match(main, /attachActionHandler\(ui\.quickBrightnessBtn, wrapProtectedAction\(\(\) => handleQuickEdit\("brightness"\)\)\)/);
  assert.match(main, /attachActionHandler\(ui\.quickLevelsBtn, wrapProtectedAction\(\(\) => handleQuickEdit\("levels"\)\)\)/);
  assert.match(main, /attachActionHandler\(ui\.quickCurvesBtn, wrapProtectedAction\(\(\) => handleQuickEdit\("curves"\)\)\)/);
  assert.match(html, /id="quickWhiteBalanceBtn"[^>]*disabled/);
  assert.doesNotMatch(section, /assets\/icons\/quick-|<img/);
  assert.doesNotMatch(main, /attachActionHandler\(ui\.quickWhiteBalanceBtn/);
});

test("showing QUICK EDIT has no expansion listener or Photoshop action path", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.doesNotMatch(mainSource, /quickEditToggle|quickEditContent|toggleQuickEditPanel/);
  const quickBindings = Array.from(mainSource.matchAll(/attachActionHandler\(ui\.(quick\w+),/g), match => match[1]);
  assert.deepEqual(quickBindings, ["quickBrightnessBtn", "quickLevelsBtn", "quickCurvesBtn"]);
  assert.doesNotMatch(mainSource, /addEventListener\([^)]*quick-edit-section|addEventListener\([^)]*quickEditReport/);
});

test("no selected photo reports a clear error without opening or saving a document", async () => {
  const h = makeHost({ selected: [] });
  await assert.rejects(runAlbumQuickEdit("brightness", { photoshop: h.photoshop }),
    /Select one or more photo Smart Object layers/);
  assert.deepEqual(h.events.filter(value => /^(open|save|close):/.test(value)), []);
});

test("selected nested Smart Object is edited, saved, closed, and album selection restored", async () => {
  const h = makeHost();
  const result = await runAlbumQuickEdit("brightness", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(h.events.filter(value => /^(open|save|close):/.test(value)), ["open:11", "save:11", "close:11:discard"]);
  assert.equal(h.photoshop.app.activeDocument, h.album);
  assert.deepEqual(h.album.activeLayers.map(layer => layer.id), [11]);
  assert.equal(h.album.save, undefined);
  assert.equal(h.album.close, undefined);
});

test("multiple selected photos are processed sequentially and original multi-selection returns", async () => {
  const h = makeHost({ selected: [smart(11, "a"), smart(12, "b")] });
  const result = await runAlbumQuickEdit("levels", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 2);
  assert.deepEqual(h.events.filter(value => /^(open|save|close):/.test(value)), ["open:11", "save:11", "close:11:discard", "open:12", "save:12", "close:12:discard"]);
  assert.deepEqual(h.album.activeLayers.map(layer => layer.id), [11, 12]);
});

test("album background and linked Smart Objects fail safely while valid selection can proceed", async () => {
  const valid = smart(11, "a");
  const linked = smart(12, "b", { linked: true });
  const h = makeHost({ selected: [valid, linked] });
  h.album.activeLayers.push(h.album.layers[1]);
  const result = await runAlbumQuickEdit("curves", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(h.events.filter(value => value.startsWith("open:")), ["open:11"]);
  assert.deepEqual(h.album.activeLayers.map(layer => layer.id), [11, 12, 2]);
});

test("shared embedded contents block correction of either instance", async () => {
  const h = makeHost({ selected: [smart(11, "shared")], other: [smart(12, "shared")] });
  const result = await runAlbumQuickEdit("brightness", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 0);
  assert.equal(result.failedCount, 1);
  assert.match(result.items[0].message, /shares|shared/i);
  assert.equal(h.events.some(value => value.startsWith("open:")), false);
});

test("failed correction closes only plugin-owned inner PSB without saving and continues", async () => {
  const h = makeHost({ selected: [smart(11, "a"), smart(12, "b")] });
  const apply = async (kind, options) => {
    if (options.photoshop.app.activeDocument.name === "Photo 11.psb") throw new Error("descriptor rejected");
    return correction(kind, options);
  };
  const result = await runAlbumQuickEdit("curves", { photoshop: h.photoshop, applyCorrection: apply });
  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(h.events.filter(value => /^(open|save|close):/.test(value)), ["open:11", "close:11:discard", "open:12", "save:12", "close:12:discard"]);
});

test("save failure is never counted as success", async () => {
  const h = makeHost({ failSave: new Set([11]) });
  const result = await runAlbumQuickEdit("brightness", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 0);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(h.events.filter(value => /^(save|close):/.test(value)), ["save:11", "close:11:discard"]);
});

test("already-open Smart Object contents are never claimed, saved, or closed", async () => {
  const h = makeHost({ existingOpen: new Set([11]) });
  const result = await runAlbumQuickEdit("levels", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 0);
  assert.equal(result.failedCount, 1);
  assert.match(result.items[0].message, /new owned/);
  assert.equal(h.photoshop.app.documents.length, 2);
  assert.equal(h.events.some(value => /^(save|close|register):/.test(value)), false);
  assert.equal(h.photoshop.app.activeDocument, h.album);
});

test("multi-layer inner PSB applies correction and saves owned document", async () => {
  const h = makeHost({ ambiguousInner: new Set([11]) });
  const result = await runAlbumQuickEdit("curves", {
    photoshop: h.photoshop,
    applyCorrection: correction
  });

  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(
    h.events.filter(value => /^(open|save|close):/.test(value)),
    ["open:11", "save:11", "close:11:discard"]
  );
  assert.equal(h.photoshop.app.activeDocument, h.album);
});

test("cancellation stops later photos and reports them", async () => {
  const h = makeHost({ selected: [smart(11, "a"), smart(12, "b")], cancelAfterSave: true });
  const result = await runAlbumQuickEdit("levels", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.items[1].outcome, "cancelled");
  assert.deepEqual(h.events.filter(value => value.startsWith("open:")), ["open:11"]);
});

test("a saved inner document that will not close stops the batch and reports remaining photos", async () => {
  const h = makeHost({ selected: [smart(11, "a"), smart(12, "b")], failClose: new Set([11]) });
  const result = await runAlbumQuickEdit("brightness", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.successCount, 0);
  assert.equal(result.failedCount, 2);
  assert.equal(result.items[0].outcome, "saved-close-failed");
  assert.equal(result.items[1].outcome, "not-processed");
  assert.deepEqual(h.events.filter(value => value.startsWith("open:")), ["open:11"]);
});

test("new inner PSB is registered for auto-close even when open reports an error", async () => {
  const h = makeHost({ openErrorAfterCreate: new Set([11]) });
  const result = await runAlbumQuickEdit("brightness", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.failedCount, 1);
  assert.equal(h.events.some(value => value.startsWith("save:")), false);
  assert.deepEqual(h.events.filter(value => /^(register|close|unregister):/.test(value)), ["register:111", "close:11:discard", "unregister:111"]);
});

test("default album action reaches recorded adjustment descriptors in the opened PSB", async () => {
  const h = makeHost();
  const result = await runAlbumQuickEdit("curves", { photoshop: h.photoshop });
  assert.equal(result.successCount, 1);
  assert.ok(h.events.includes("make:curves"));
  assert.ok(h.events.includes("set:curves"));
  assert.ok(h.events.includes("get:smartObject"));
  assert.ok(h.events.includes("get:smartObjectMore"));
  assert.ok(h.events.includes("save:11"));
});

test("thrown open after PSB creation still registers owned document for cleanup", async () => {
  const h = makeHost({ throwOpenAfterCreate: new Set([11]) });
  const result = await runAlbumQuickEdit("curves", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.failedCount, 1);
  assert.deepEqual(h.events.filter(value => /^(register|close|unregister):/.test(value)), ["register:111", "close:11:discard", "unregister:111"]);
});

test("unavailable Smart Object identity fails closed before opening contents", async () => {
  const h = makeHost({ selected: [smart(11, undefined)] });
  const result = await runAlbumQuickEdit("brightness", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.failedCount, 1);
  assert.match(result.items[0].message, /identity is unavailable/);
  assert.equal(h.events.some(value => value.startsWith("open:")), false);
});

test("an unexpected second opened document is closed without saving and not claimed as success", async () => {
  const h = makeHost({ extraOpenDoc: new Set([11]) });
  const result = await runAlbumQuickEdit("levels", { photoshop: h.photoshop, applyCorrection: correction });
  assert.equal(result.failedCount, 1);
  assert.equal(h.photoshop.app.documents.length, 1);
  assert.equal(h.events.some(value => value.startsWith("save:")), false);
  assert.ok(h.events.includes("close:11:discard"));
  assert.ok(h.events.includes("close-extra:11:discard"));
});

test("cancellation after the adjustment but before save discards the inner PSB", async () => {
  const h = makeHost({ cancelAfterSet: true });
  const result = await runAlbumQuickEdit("curves", { photoshop: h.photoshop });
  assert.equal(result.successCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.items[0].outcome, "cancelled");
  assert.equal(h.events.some(value => value.startsWith("save:")), false);
  assert.ok(h.events.includes("close:11:discard"));
});

test("selection restoration uses a fresh modal scope after host cancellation", async () => {
  const h = makeHost({ strictCancelledSelect: true });
  const apply = async () => { h.cancel(); return { success: true, outcome: "applied" }; };
  const result = await runAlbumQuickEdit("levels", { photoshop: h.photoshop, applyCorrection: apply });
  assert.equal(result.items[0].outcome, "cancelled");
  assert.equal(result.restoreError, undefined);
  assert.equal(h.events.some(value => value.startsWith("save:")), false);
  assert.deepEqual(h.album.activeLayers.map(layer => layer.id), [11]);
});
