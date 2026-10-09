"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  buildAutoPhotoFillResult,
  buildSaveEditedPhotosResult,
  buildEditedPhotosPathText
} = require("../main");

test("AUTO PHOTO FILL completion models distinguish unmatched items from failures", () => {
  const complete = buildAutoPhotoFillResult({ outcome: "complete", placedCount: 8, movedCount: 8 });
  assert.equal(complete.type, "success");
  assert.equal(complete.title, "PHOTO FILL COMPLETE");
  assert.equal(complete.summary, "8 PHOTOS FILLED");
  assert.deepEqual(complete.detailLines, ["All selected placeholders filled", "Album Used: 8 photos moved"]);

  const unmatched = buildAutoPhotoFillResult({
    outcome: "complete", placedCount: 7, movedCount: 7,
    unmatchedPlaceholders: [{}], unmatchedPhotos: [{}, {}]
  });
  assert.equal(unmatched.type, "success");
  assert.deepEqual(unmatched.detailLines, ["1 PLACEHOLDER SKIPPED", "2 PHOTOS UNUSED", "Album Used: 7 photos moved"]);

  const photoFailure = buildAutoPhotoFillResult({
    outcome: "completed-with-errors", placedCount: 7,
    failedPhotos: [{ error: new Error("Could not read image") }]
  });
  assert.equal(photoFailure.type, "warning");
  assert.equal(photoFailure.reason, "Could not read image");

  const moveFailure = buildAutoPhotoFillResult({
    outcome: "completed-with-errors", placedCount: 7,
    moveFailures: [{ error: new Error("Move denied") }]
  });
  assert.equal(moveFailure.type, "warning");
  assert.ok(moveFailure.detailLines.includes("1 MOVE FAILED"));
  assert.equal(moveFailure.reason, "Move denied");

  const placeholderFailure = buildAutoPhotoFillResult({
    outcome: "completed-with-errors", placedCount: 7,
    placeholderFailures: [{ error: new Error("Bad bounds") }]
  });
  assert.equal(placeholderFailure.type, "warning");
  assert.equal(placeholderFailure.reason, "Bad bounds");

  const error = buildAutoPhotoFillResult({ outcome: "error", error: new Error("Photoshop unavailable") });
  assert.equal(error.type, "error");
  assert.equal(error.reason, "Photoshop unavailable");
});

test("AUTO PHOTO FILL non-completion outcomes have no popup model", () => {
  for (const outcome of ["cancelled", "no-placeholders", "invalid-placeholders"]) {
    assert.equal(buildAutoPhotoFillResult({ outcome }), null);
  }
});

test("SAVE EDITED PHOTOS models include result counts and first failure", () => {
  const folder = { nativePath: "D:\\Wedding\\Edited Photos" };
  const success = buildSaveEditedPhotosResult({ outcome: "success", successCount: 8, failedCount: 0, destinationFolder: folder });
  assert.equal(success.type, "success");
  assert.equal(success.title, "EDITED PHOTOS SAVED");
  assert.equal(success.summary, "8 PHOTOS SAVED");
  assert.equal(success.pathEntry, folder);

  const partial = buildSaveEditedPhotosResult({ outcome: "success", successCount: 7, failedCount: 1, firstFailureError: new Error("Layer export failed"), destinationFolder: folder });
  assert.equal(partial.type, "warning");
  assert.equal(partial.summary, "7 SAVED • 1 FAILED");
  assert.equal(partial.reason, "Layer export failed");
  assert.equal(partial.pathEntry, folder);

  const failed = buildSaveEditedPhotosResult({ outcome: "failed", successCount: 0, failedCount: 3, firstFailureError: new Error("Disk full"), destinationFolder: folder });
  assert.equal(failed.type, "error");
  assert.equal(failed.summary, "0 SAVED • 3 FAILED");
  assert.equal(failed.reason, "Disk full");
  assert.equal(failed.pathEntry, undefined);

  const error = buildSaveEditedPhotosResult({ outcome: "error", error: new Error("Folder unavailable") });
  assert.equal(error.type, "error");
  assert.equal(error.reason, "Folder unavailable");
});

test("SAVE EDITED PHOTOS non-completion outcomes have no popup model", () => {
  for (const outcome of ["cancelled", "no-document", "no-smart-objects"]) {
    assert.equal(buildSaveEditedPhotosResult({ outcome }), null);
  }
});

test("SAVE EDITED PHOTOS resolves native folder path for successful exports", async () => {
  const folder = { nativePath: "D:\\Wedding\\Edited Photos" };
  assert.equal(await buildEditedPhotosPathText({ pathEntry: folder }), "Saved to:\nD:\\Wedding\\Edited Photos");
  assert.equal(await buildEditedPhotosPathText({}), "");
});

function createUiHarness(autoResult, editedResult, stubPopup = true) {
  const calls = { popups: [], toasts: [] };
  const elements = new Map();
  for (const id of ["saveResultDialog", "saveResultIcon", "saveResultTitle", "saveResultFormat", "saveResultDetails", "saveResultPath", "saveResultReason"]) {
    elements.set(id, { textContent: "", hidden: false });
  }
  const dialog = elements.get("saveResultDialog");
  dialog.classList = { remove() {}, add() {} };
  dialog.uxpShowModal = async options => { dialog.modalOptions = options; };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, popupSink: calls.popups,
    document: { getElementById: id => elements.get(id) || null },
    require: name => {
      if (name === "./src/ui/toast") return { createToastManager: () => ({
        show: (message, type) => calls.toasts.push({ message, type }), dismiss() {}
      }) };
      if (name === "./src/tools/autoPhotoFill") return { runAutoPhotoFill: async () => autoResult };
      if (name === "./src/tools/saveEditedPhotos") return {
        runSaveEditedPhotos: async () => editedResult,
        buildSaveEditedPhotosToast: require("../src/tools/saveEditedPhotos").buildSaveEditedPhotosToast
      };
      return {};
    }
  };
  const sandbox = vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8"), sandbox);
  if (stubPopup) {
    vm.runInContext("showResultPopup = async popup => { if (popup) popupSink.push(popup); };", sandbox);
  }
  return { sandbox, calls, elements };
}

test("handlers route completion to the shared centered popup and preserve exceptional toasts", async () => {
  const auto = createUiHarness({ outcome: "complete", placedCount: 2, movedCount: 2 }, null);
  await auto.sandbox.handleAutoPhotoFill();
  assert.equal(auto.calls.popups.length, 1);
  assert.equal(auto.calls.toasts.length, 0);

  const unmatched = createUiHarness({ outcome: "complete", placedCount: 1, unmatchedPhotos: [{}] }, null);
  await unmatched.sandbox.handleAutoPhotoFill();
  assert.equal(unmatched.calls.popups[0].type, "success");

  const autoError = createUiHarness({ outcome: "error", error: new Error("Photoshop unavailable") }, null);
  await autoError.sandbox.handleAutoPhotoFill();
  assert.equal(autoError.calls.popups[0].type, "error");

  const edited = createUiHarness(null, { outcome: "success", successCount: 1, failedCount: 0 });
  await edited.sandbox.handleSaveEditedPhotos();
  assert.equal(edited.calls.popups[0].type, "success");
  assert.equal(edited.calls.toasts.length, 0);

  const editedPartial = createUiHarness(null, { outcome: "success", successCount: 1, failedCount: 1 });
  await editedPartial.sandbox.handleSaveEditedPhotos();
  assert.equal(editedPartial.calls.popups[0].type, "warning");

  const editedFailed = createUiHarness(null, { outcome: "failed", successCount: 0, failedCount: 1 });
  await editedFailed.sandbox.handleSaveEditedPhotos();
  assert.equal(editedFailed.calls.popups[0].type, "error");

  const cancelled = createUiHarness({ outcome: "cancelled" }, { outcome: "cancelled" });
  await cancelled.sandbox.handleAutoPhotoFill();
  await cancelled.sandbox.handleSaveEditedPhotos();
  assert.equal(cancelled.calls.popups.length, 0);

  const noPlaceholders = createUiHarness({ outcome: "no-placeholders" }, null);
  await noPlaceholders.sandbox.handleAutoPhotoFill();
  assert.equal(noPlaceholders.calls.popups.length, 0);
  assert.equal(noPlaceholders.calls.toasts[0].type, "warning");

  for (const outcome of ["no-document", "no-smart-objects"]) {
    const h = createUiHarness(null, { outcome });
    await h.sandbox.handleSaveEditedPhotos();
    assert.equal(h.calls.popups.length, 0);
    assert.equal(h.calls.toasts[0].type, "warning");
  }
});

test("shared dialog displays edited destination and resets optional fields for SAVE PAGE", async () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.match(html, /id="saveResultDetails"/);
  const h = createUiHarness(null, null, false);
  const popup = buildSaveEditedPhotosResult({
    outcome: "success", successCount: 1, failedCount: 0,
    destinationFolder: { nativePath: "D:\\Wedding\\Edited Photos" }
  });
  await h.sandbox.showResultPopup(popup);
  assert.equal(h.elements.get("saveResultPath").textContent, "Saved to:\nD:\\Wedding\\Edited Photos");
  assert.equal(h.elements.get("saveResultTitle").textContent, "EDITED PHOTOS SAVED");

  await h.sandbox.showSaveResultPopup({ outcome: "success", outputMode: "jpeg", jpegEntry: { nativePath: "D:\\Wedding\\JPG\\page.jpg" } });
  assert.equal(h.elements.get("saveResultFormat").textContent, "JPG ONLY");
  assert.equal(h.elements.get("saveResultDetails").hidden, true);
  assert.equal(h.elements.get("saveResultPath").textContent, "Saved to:\nD:\\Wedding\\JPG");
});
