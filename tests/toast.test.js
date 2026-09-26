"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createToastManager } = require("../src/ui/toast");
const { buildAutoPhotoFillToast } = require("../main");
const { executeSwapPhotos } = require("../src/tools/swapPhotos");

function createMockToastElement() {
  return {
    textContent: "",
    className: "toast",
    hidden: true
  };
}

test("1. success toast: 2 photos swapped", async () => {
  const el = createMockToastElement();
  const toast = createToastManager(el);

  const photoA = { id: 101, kind: "smartObject", name: "Photo A" };
  const photoB = { id: 102, kind: "smartObject", name: "Photo B" };
  const allLayers = [photoA, photoB];

  const result = await executeSwapPhotos({
    getSelectedLayersTopToBottom: () => [photoA, photoB],
    getAllDocumentLayers: () => allLayers,
    exportSmartObjectContents: async () => {},
    replaceSmartObjectContents: async () => {},
    createTempFiles: async count => Array.from({ length: count }, (_, i) => ({ name: `temp${i+1}.psb`, delete: async () => {} }))
  });

  assert.equal(result.success, true);
  toast.show(result.message, "success");
  assert.equal(el.textContent, "2 photos swapped");
  assert.equal(el.className, "toast success");
  assert.equal(el.hidden, false);
  toast.dismiss();
});

test("2. success toast: 3 photos swapped", async () => {
  const el = createMockToastElement();
  const toast = createToastManager(el);

  const photoA = { id: 101, kind: "smartObject", name: "Photo A" };
  const photoB = { id: 102, kind: "smartObject", name: "Photo B" };
  const photoC = { id: 103, kind: "smartObject", name: "Photo C" };
  const allLayers = [photoA, photoB, photoC];

  const result = await executeSwapPhotos({
    getSelectedLayersTopToBottom: () => [photoA, photoB, photoC],
    getAllDocumentLayers: () => allLayers,
    exportSmartObjectContents: async () => {},
    replaceSmartObjectContents: async () => {},
    createTempFiles: async count => Array.from({ length: count }, (_, i) => ({ name: `temp${i+1}.psb`, delete: async () => {} }))
  });

  assert.equal(result.success, true);
  toast.show(result.message, "success");
  assert.equal(el.textContent, "3 photos swapped");
  assert.equal(el.className, "toast success");
  assert.equal(el.hidden, false);
  toast.dismiss();
});

test("3. invalid count warning", async () => {
  const el = createMockToastElement();
  const toast = createToastManager(el);

  const result = await executeSwapPhotos({
    getSelectedLayersTopToBottom: () => [{ id: 101, kind: "smartObject" }],
    getAllDocumentLayers: () => []
  });

  assert.equal(result.success, false);
  toast.show(result.message, "warning");
  assert.equal(el.textContent, "Select 2 or 3 Smart Object photos");
  assert.equal(el.className, "toast warning");
  assert.equal(el.hidden, false);
  toast.dismiss();
});

test("3b. runtime failure toast: Swap failed", async () => {
  const el = createMockToastElement();
  const toast = createToastManager(el);

  const photoA = { id: 101, kind: "smartObject", name: "Photo A" };
  const photoB = { id: 102, kind: "smartObject", name: "Photo B" };
  const result = await executeSwapPhotos({
    getSelectedLayersTopToBottom: () => [photoA, photoB],
    getAllDocumentLayers: () => [photoA, photoB],
    exportSmartObjectContents: async () => { throw new Error("Disk error"); },
    createTempFiles: async count => Array.from({ length: count }, (_, i) => ({ name: `temp${i+1}.psb`, delete: async () => {} }))
  });

  assert.equal(result.success, false);
  assert.equal(result.outcome, "error");
  assert.equal(result.message, "Swap failed");
  toast.show(result.message, "error");
  assert.equal(el.textContent, "Swap failed");
  assert.equal(el.className, "toast error");
  assert.equal(el.hidden, false);
  toast.dismiss();
});


test("4. new toast replaces previous toast", () => {
  const el = createMockToastElement();
  const toast = createToastManager(el, 3000);

  toast.show("First toast", "info");
  assert.equal(el.textContent, "First toast");
  assert.equal(el.className, "toast info");
  assert.ok(toast.getTimer() !== null);

  toast.show("Second toast", "success");
  assert.equal(el.textContent, "Second toast");
  assert.equal(el.className, "toast success");
  assert.ok(toast.getTimer() !== null);

  toast.dismiss();
  assert.equal(el.hidden, true);
  assert.equal(toast.getTimer(), null);
});

test("5. toast auto-dismiss scheduling", async () => {
  const el = createMockToastElement();
  const toast = createToastManager(el, 50); // 50ms for quick test

  toast.show("Auto dismiss test", "success");
  assert.equal(el.hidden, false);
  assert.ok(toast.getTimer() !== null);

  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(el.hidden, true);
  assert.equal(toast.getTimer(), null);
});

test("6. Auto Photo Fill uses toast summary", () => {
  // Case A: 5 photos filled • 1 skipped
  const res1 = buildAutoPhotoFillToast({
    placedCount: 5,
    unmatchedPhotos: [{ name: "photo6.jpg" }],
    failedPhotos: [],
    moveFailures: []
  });
  assert.equal(res1.message, "5 photos filled • 1 skipped");
  assert.equal(res1.type, "success");

  // Case B: 5 photos filled
  const res2 = buildAutoPhotoFillToast({
    placedCount: 5,
    unmatchedPhotos: [],
    failedPhotos: [],
    moveFailures: []
  });
  assert.equal(res2.message, "5 photos filled");
  assert.equal(res2.type, "success");

  // Case C: 5 photos filled • 1 move failed
  const res3 = buildAutoPhotoFillToast({
    placedCount: 5,
    unmatchedPhotos: [],
    failedPhotos: [],
    moveFailures: [{ file: { name: "failed.jpg" }, error: new Error("locked") }]
  });
  assert.equal(res3.message, "5 photos filled • 1 move failed");
  assert.equal(res3.type, "warning");

  // Case D: no placeholders
  const res4 = buildAutoPhotoFillToast({ outcome: "no-placeholders" });
  assert.equal(res4.message, "Select one or more placeholder layers first.");
  assert.equal(res4.type, "warning");

  // Case E: cancelled
  const res5 = buildAutoPhotoFillToast({ outcome: "cancelled" });
  assert.equal(res5.message, "Cancelled.");

  // Case F: error
  const res6 = buildAutoPhotoFillToast({ outcome: "error" });
  assert.equal(res6.message, "Auto Photo Fill failed");
  assert.equal(res6.type, "error");
});

test("7. no completion dialog exists", () => {
  const htmlPath = path.resolve(__dirname, "../index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.equal(/<dialog/i.test(html), false, "no HTMLDialogElement should exist in index.html");
  assert.equal(/resultDialog/i.test(html), false, "no resultDialog ID should exist in index.html");
});

test("8. no permanent result block remains if it is no longer required", () => {
  const htmlPath = path.resolve(__dirname, "../index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.equal(/id="resultPanel"/i.test(html), false, "resultPanel section should not exist in v0.3.0 index.html");
  assert.equal(/resultPanelMessage/i.test(html), false, "resultPanelMessage should not exist in v0.3.0 index.html");
});
