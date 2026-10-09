"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../dev/quick-correction-poc.psjs"), "utf8");

function loadRunner() {
  const sandbox = { console, __QUICK_CORRECTION_POC_TEST__: true };
  sandbox.globalThis = sandbox;
  return vm.runInNewContext(source + "\nquickCorrectionPoc.run", sandbox, { filename: "quick-correction-poc.psjs" });
}

function host(overrides = {}) {
  const document = {
    id: 42,
    name: "Photo.psb",
    layers: [{ id: 7, kind: "normal" }],
    activeLayers: [{ id: 7, kind: "normal" }],
    historyStates: { length: 2 }
  };
  const calls = [];
  const photoshop = {
    app: { activeDocument: document },
    constants: { LayerKind: { NORMAL: "normal" } },
    core: { executeAsModal: async fn => { calls.push("modal"); return fn(); } },
    action: { batchPlay: async descriptors => {
      calls.push(descriptors[0]._obj);
      document.historyStates.length++;
      return [{}];
    } }
  };
  Object.assign(photoshop, overrides);
  return { photoshop, document, calls };
}

test("Auto Color candidate runs alone in modal on active PSB", async () => {
  const { photoshop, calls } = host();
  const result = await loadRunner()("autoColor", photoshop);
  assert.equal(result.command, "autoColor");
  assert.equal(result.commandAccepted, true);
  assert.equal(result.historyStateAdded, true);
  assert.equal(result.visibleEffect, "manual-check-required");
  assert.deepEqual(calls, ["modal", "autoColor"]);
});

test("Auto Light is explicitly an Auto Tone candidate", async () => {
  const { photoshop, calls } = host();
  const result = await loadRunner()("autoLight", photoshop);
  assert.equal(result.command, "autoTone");
  assert.match(result.candidate, /Auto Tone/);
  assert.deepEqual(calls, ["modal", "autoTone"]);
});

test("Auto White Balance fails without invoking a substitute", async () => {
  const { photoshop, calls } = host();
  const result = await loadRunner()("autoWhiteBalance", photoshop);
  assert.equal(result.commandAccepted, false);
  assert.equal(result.status, "unsupported");
  assert.deepEqual(calls, []);
});

test("rejects album PSD and original JPG before mutation", async () => {
  for (const name of ["Album.psd", "photo.jpg"]) {
    const { photoshop, document, calls } = host();
    document.name = name;
    const result = await loadRunner()("autoColor", photoshop);
    assert.equal(result.status, "blocked");
    assert.deepEqual(calls, []);
  }
});

test("batchPlay error descriptors and missing modal report failure", async () => {
  const { photoshop, calls } = host();
  photoshop.action.batchPlay = async descriptors => {
    calls.push(descriptors[0]._obj);
    return [{ _obj: "error", message: "Command unavailable" }];
  };
  const rejected = await loadRunner()("autoColor", photoshop);
  assert.equal(rejected.commandAccepted, false);
  assert.match(rejected.error, /Command unavailable/);

  photoshop.core = {};
  calls.length = 0;
  const noModal = await loadRunner()("autoColor", photoshop);
  assert.equal(noModal.status, "unsupported");
  assert.deepEqual(calls, []);
});

test("document switch during modal blocks the command", async () => {
  const { photoshop, calls } = host();
  photoshop.core.executeAsModal = async fn => {
    photoshop.app.activeDocument = { id: 99, name: "Other.psb" };
    return fn();
  };
  const result = await loadRunner()("autoColor", photoshop);
  assert.equal(result.commandAccepted, false);
  assert.deepEqual(calls, []);
});

test("accepted descriptor without a new history state does not claim modification", async () => {
  const { photoshop } = host();
  photoshop.action.batchPlay = async () => [{}];
  const result = await loadRunner()("autoColor", photoshop);
  assert.equal(result.commandAccepted, true);
  assert.equal(result.historyStateAdded, false);
  assert.equal(result.modifiedIntendedDocument, null);
});

test("unknown layer kind and thrown host errors fail safely", async () => {
  const { photoshop, document, calls } = host();
  document.activeLayers[0].kind = undefined;
  document.layers[0].kind = undefined;
  const blocked = await loadRunner()("autoColor", photoshop);
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(calls, []);

  document.activeLayers[0].kind = "normal";
  document.layers[0].kind = "normal";
  photoshop.action.batchPlay = async () => { throw new Error("Host rejected command"); };
  const failed = await loadRunner()("autoColor", photoshop);
  assert.equal(failed.status, "failed");
  assert.equal(failed.commandAccepted, false);
  assert.match(failed.error, /Host rejected command/);
});
