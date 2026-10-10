"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "photoshop") return { app: {}, action: {}, core: {}, constants: { LayerKind: {} } };
  return originalLoad.call(this, request, parent, isMain);
};
const { autoBrightness, autoLevels, autoCurves } = require("../src/tools/quickCorrections");
const { autoWhiteBalance } = require("../src/tools/autoWhiteBalance");
Module._load = originalLoad;

function makeHost({ onCommand } = {}) {
  const photo = { id: 10, name: "Original Photo", kind: "normal", isClippingMask: false };
  const unrelated = { id: 20, name: "Unrelated overlay", kind: "normal", isClippingMask: false };
  const doc = { id: 5, name: "Photo.psb", layers: [unrelated, photo], activeLayers: [photo], selection: { bounds: null } };
  const commands = [];
  const commits = [];
  let nextId = 30;
  const photoshop = {
    app: { activeDocument: doc },
    constants: { LayerKind: {
      NORMAL: "normal", SMARTOBJECT: "smartObject",
      BRIGHTNESSCONTRAST: "brightnessContrast", LEVELS: "levels", CURVES: "curves"
    } },
    core: { executeAsModal: async fn => fn({ hostControl: {
      suspendHistory: async () => ({ layers: doc.layers.slice(), selected: doc.activeLayers.slice() }),
      resumeHistory: async (snapshot, commit = true) => {
        commits.push(commit);
        if (!commit) {
          doc.layers = snapshot.layers;
          doc.activeLayers = snapshot.selected;
        }
      }
    } }) },
    action: { batchPlay: async descriptors => {
      const command = descriptors[0];
      commands.push(command);
      if (onCommand) {
        const override = onCommand(command);
        if (override) return override;
      }
      if (command._obj === "make") {
        const adjustmentKind = {
          brightnessEvent: "brightnessContrast", levels: "levels", curves: "curves"
        }[command.using.type._obj];
        const layer = { id: nextId++, name: "New Adjustment", kind: adjustmentKind, isClippingMask: false };
        doc.layers.splice(doc.layers.findIndex(item => item.id === doc.activeLayers[0].id), 0, layer);
        doc.activeLayers = [layer];
      }
      if (command._obj === "select") {
        doc.activeLayers = [doc.layers.find(item => item.id === command._target[0]._id)];
      }
      return [{}];
    } }
  };
  return { photoshop, doc, photo, unrelated, commands, commits };
}

for (const [label, run, type] of [
  ["Brightness/Contrast", autoBrightness, "brightnessEvent"],
  ["Levels", autoLevels, "levels"],
  ["Curves", autoCurves, "curves"]
]) {
  test(`${label} creates one named clipped adjustment above the selected photo`, async () => {
    const host = makeHost();
    const result = await run({ photoshop: host.photoshop });
    assert.equal(result.outcome, "applied");
    assert.equal(host.doc.layers.length, 3);
    assert.equal(host.doc.layers[1].name, `FM Auto ${label} [FMQE]`);
    assert.equal(host.doc.layers[1].isClippingMask, true);
    assert.equal(host.doc.layers[2], host.photo);
    assert.equal(host.doc.layers[0], host.unrelated);
    assert.equal(host.photo.name, "Original Photo");
    assert.deepEqual(host.doc.activeLayers, [host.photo]);
    assert.deepEqual(host.commits, [true]);
    assert.equal(host.commands[0].using._obj, "adjustmentLayer");
    assert.equal(host.commands[0].using.type._obj, type);
    assert.equal(host.commands[1].to._obj, type);
  });
}

test("each action retains its recorded auto settings", async () => {
  const brightness = makeHost();
  await autoBrightness({ photoshop: brightness.photoshop });
  assert.equal(brightness.commands[1].to.auto, true);
  assert.equal(brightness.commands[1].to.useLegacy, false);

  for (const run of [autoLevels, autoCurves]) {
    const host = makeHost();
    await run({ photoshop: host.photoshop });
    assert.equal(host.commands[1].to.adjustment[0].autoFaces, true);
    assert.equal(host.commands[1].to.adjustment[0].autoMachineLearning, true);
  }
});

test("repeating one correction updates the plugin layer without stacking a duplicate", async () => {
  const host = makeHost();
  await autoLevels({ photoshop: host.photoshop });
  const commandCount = host.commands.length;
  const repeated = await autoLevels({ photoshop: host.photoshop });
  assert.equal(repeated.outcome, "updated");
  assert.equal(host.doc.layers.length, 3);
  assert.equal(host.commands.slice(commandCount).filter(command => command._obj === "make").length, 0);
  assert.equal(host.commands.slice(commandCount).filter(command => command._obj === "set").length, 1);
  assert.deepEqual(host.doc.activeLayers, [host.photo]);
});

test("a Photoshop error descriptor rolls back the new layer", async () => {
  const host = makeHost({ onCommand: command => command._obj === "set" ? [{ _obj: "error", message: "unsupported" }] : null });
  await assert.rejects(autoCurves({ photoshop: host.photoshop }), /unsupported/);
  assert.deepEqual(host.doc.layers, [host.unrelated, host.photo]);
  assert.deepEqual(host.commits, [false]);
});

test("a failed repeated update rolls back without creating another layer", async () => {
  let rejectSet = false;
  const host = makeHost({ onCommand: command => rejectSet && command._obj === "set"
    ? [{ _obj: "error", message: "update rejected" }] : null });
  await autoLevels({ photoshop: host.photoshop });
  rejectSet = true;
  await assert.rejects(autoLevels({ photoshop: host.photoshop }), /update rejected/);
  assert.equal(host.doc.layers.length, 3);
  assert.equal(host.doc.layers[1].name, "FM Auto Levels [FMQE]");
  assert.deepEqual(host.commits, [true, false]);
});

test("invalid document or selected layer stops before modification", async () => {
  const host = makeHost();
  host.doc.name = "Album.psd";
  await assert.rejects(autoBrightness({ photoshop: host.photoshop }), /PSB/);
  host.doc.name = "Photo.psb";
  host.doc.activeLayers = [host.unrelated, host.photo];
  await assert.rejects(autoBrightness({ photoshop: host.photoshop }), /one photo/);
  assert.equal(host.commands.length, 0);
});

test("a clipped photo is rejected because its base may be another layer", async () => {
  const host = makeHost();
  host.photo.isClippingMask = true;
  await assert.rejects(autoLevels({ photoshop: host.photoshop }), /clipped photo/i);
  assert.equal(host.commands.length, 0);
});

test("a pixel selection or unavailable selection state blocks adjustment creation", async () => {
  const host = makeHost();
  host.doc.selection.bounds = { left: 1, top: 1, right: 10, bottom: 10 };
  await assert.rejects(autoCurves({ photoshop: host.photoshop }), /Deselect/);
  host.doc.selection = undefined;
  await assert.rejects(autoCurves({ photoshop: host.photoshop }), /selection state is unavailable/);
  assert.equal(host.commands.length, 0);
});

test("a reserved name on the wrong layer type is not treated as already applied", async () => {
  const host = makeHost();
  host.doc.layers.splice(1, 0, { id: 21, name: "FM Auto Levels", kind: "normal", isClippingMask: true });
  await assert.rejects(autoLevels({ photoshop: host.photoshop }), /ambiguous existing layer/i);
  assert.equal(host.commands.length, 0);
});

test("a legacy same-named adjustment is not assumed to be plugin-managed", async () => {
  const host = makeHost();
  host.doc.layers.splice(1, 0, { id: 88, name: "FM Auto Levels", kind: "levels", isClippingMask: true });
  await assert.rejects(autoLevels({ photoshop: host.photoshop }), /ambiguous existing layer/);
  assert.equal(host.commands.length, 0);
});

test("a renamed adjustment of the same type blocks another layer", async () => {
  const host = makeHost();
  await autoLevels({ photoshop: host.photoshop });
  host.doc.layers[1].name = "Renamed Levels";
  const count = host.commands.length;
  await assert.rejects(autoLevels({ photoshop: host.photoshop }), /ambiguous existing layer/i);
  assert.equal(host.commands.length, count);
});

test("a plugin-named correction moved away from the photo blocks a duplicate", async () => {
  const host = makeHost();
  host.doc.layers.unshift({ id: 88, name: "FM Auto Levels [FMQE]", kind: "levels", isClippingMask: false });
  await assert.rejects(autoLevels({ photoshop: host.photoshop }), /ambiguous existing layer/i);
  assert.equal(host.commands.length, 0);
});

test("multiple plugin-named corrections block another update", async () => {
  const host = makeHost();
  host.doc.layers.splice(1, 0,
    { id: 88, name: "FM Auto Levels [FMQE]", kind: "levels", isClippingMask: true },
    { id: 89, name: "FM Auto Levels [FMQE]", kind: "levels", isClippingMask: true });
  await assert.rejects(autoLevels({ photoshop: host.photoshop }), /ambiguous existing layer/i);
  assert.equal(host.commands.length, 0);
});

test("Auto White Balance remains disabled and performs no Photoshop action", async () => {
  const host = makeHost();
  const result = await autoWhiteBalance({ photoshop: host.photoshop });
  assert.equal(result.outcome, "unsupported");
  assert.equal(result.success, false);
  assert.equal(host.commands.length, 0);
});

test("QUICK EDIT controls replace White Balance with protected Adjust Light", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
  assert.match(html, /QUICK EDIT[\s\S]*?Select embedded album photos or open a photo PSB[^<]*Photoshop 25\+/);
  for (const id of ["quickBrightnessBtn", "quickLevelsBtn", "quickCurvesBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(main, new RegExp(`attachActionHandler\\(ui\\.${id}, wrapProtectedAction`));
  }
  assert.doesNotMatch(html, /id="quickWhiteBalanceBtn"/);
  assert.match(html, /id="adjustLightBtn"[^>]*role="button"/);
  assert.match(main, /attachActionHandler\(ui\.adjustLightBtn, wrapProtectedAction\(handleAdjustLight\)\)/);
  assert.match(html, /id="adjustLightDialog"/);
  assert.match(html, /id="adjustLightSlider"[^>]*type="range"/);
  assert.match(html, /id="adjustLightSlider"[^>]*min="-100" max="100" step="1"/);
  assert.doesNotMatch(html.match(/<main[^>]*class="panel"[^>]*>([\s\S]*?)<\/main>/)?.[1] || "", /<input/i);
});

test("panel handler does not report an unsupported correction as success", async () => {
  const main = require("../main");
  const load = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "./src/tools/albumQuickEdit") {
      return { runAlbumQuickEdit: async () => ({ success: false, outcome: "failed", successCount: 0, failedCount: 1, items: [{ message: "Unsupported by host" }] }) };
    }
    return load.call(this, request, parent, isMain);
  };
  try {
    const result = await main.handleQuickEdit("brightness");
    assert.equal(result.success, false);
    assert.equal(result.outcome, "failed");
  } finally {
    Module._load = load;
  }
});

test("QUICK EDIT report names each selected photo and its outcome", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  assert.match(html, /id="quickEditReport"[^>]*hidden/);
  const { formatQuickEditReport } = require("../main");
  const message = formatQuickEditReport("levels", {
    successCount: 1, failedCount: 1,
    items: [
      { layerName: "Photo A", outcome: "applied" },
      { layerName: "Photo B", outcome: "failed", message: "Linked Smart Object" }
    ]
  });
  assert.match(message, /Auto Levels: 1 saved, 1 failed/);
  assert.match(message, /Photo A: saved/);
  assert.match(message, /Photo B: Linked Smart Object/);
});
