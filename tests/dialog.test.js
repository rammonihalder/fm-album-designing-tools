"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { executeAutoPhotoFill } = require("../src/tools/autoPhotoFill");

function folderDialogHarness() {
  const path = require("node:path");
  const elements = new Map();
  function element() {
    return {
      children: [], listeners: new Map(), attributes: {}, hidden: true, disabled: false, textContent: "",
      get firstChild() { return this.children[0]; },
      appendChild(child) { this.children.push(child); },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key] ?? null; },
      addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); },
      removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); },
      async fire(name, extra = {}) { for (const fn of this.listeners.get(name) || []) await fn({ preventDefault() {}, stopPropagation() {}, ...extra }); },
      focus() {}
    };
  }
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  const dialog = elements.get("folderBrowserDialog");
  assert.ok(dialog, "new shared dialog must exist in markup");
  let closeModal, open = false, shows = 0, pickerCalls = 0, pickerResult = null;
  dialog.uxpShowModal = () => { shows++; open = true; return new Promise(resolve => { closeModal = resolve; }); };
  dialog.close = reason => { open = false; closeModal(reason); };
  const sandbox = { module: { exports: {} }, console: { log() {}, error() {}, warn() {} }, setTimeout, clearTimeout,
    document: { getElementById: id => elements.get(id) || null, createElement: element },
    require: name => name === "uxp" ? { storage: { localFileSystem: { getFolder: async () => {
      assert.equal(open, false, "release custom modal before native picker"); pickerCalls++; return pickerResult;
    } } } } : require(path.resolve(__dirname, "..", name))
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"), sandbox);
  const tick = async () => { await new Promise(resolve => setImmediate(resolve)); };
  return { main: sandbox.module.exports, elements, html, tick, get shows() { return shows; }, get pickerCalls() { return pickerCalls; },
    setPickerResult: result => { pickerResult = result; } };
}

test("folder confirmation markup is compact and outside the main panel", () => {
  const h = folderDialogHarness();
  assert.match(h.html, /<dialog id="folderBrowserDialog" hidden>/);
  assert.equal(h.html.split("</main>")[0].includes('id="folderBrowserDialog"'), false);
  for (const id of ["folderBrowserCurrent", "folderBrowserSelectBtn", "folderBrowserOtherBtn", "folderBrowserCancelBtn"]) assert.ok(h.elements.has(id));
  for (const obsolete of ["SUBFOLDERS", "BACK", "No subfolders", "folderBrowserList"]) assert.equal(h.html.includes(obsolete), false);
  assert.match(h.html, />SELECT SAVE FOLDER</);
  assert.match(h.html, /Choose where this tool should save/);
  assert.match(h.html, /CURRENT FOLDER/);
  assert.match(h.html, /SELECT THIS FOLDER/);
  assert.match(h.html, /CHOOSE OTHER LOCATION/);
  assert.match(h.html, />CANCEL</);
  const css = fs.readFileSync(require("node:path").join(__dirname, "../style.css"), "utf8");
  assert.match(css, /folder-confirm-primary[^}]*width:\s*100%/);
  assert.match(css, /folder-confirm-secondary[^}]*width:\s*100%/);
  assert.match(css, /folder-browser-path[^}]*width:\s*100%/);
});

test("folder confirmation displays exact Entry and SELECT returns it via keyboard", async () => {
  const h = folderDialogHarness();
  let getEntriesCalled = false;
  const root = { name: "JOB_A", nativePath: "F:/JOB_A", isFolder: true, getEntries: async () => { getEntriesCalled = true; } };
  const promise = h.main.promptForFolderBrowser({ initialFolder: root, tool: "SAVE PAGE" });
  await h.tick();
  assert.equal(h.elements.get("folderBrowserCurrent").textContent, "F:/JOB_A");
  await h.elements.get("folderBrowserSelectBtn").fire("keydown", { key: " " });
  assert.equal((await promise).folder, root);
  assert.equal(getEntriesCalled, false);
  assert.equal(h.elements.get("folderBrowserDialog").hidden, true);
});

test("other-location picker cancellation reopens confirmation; new root needs explicit SELECT", async () => {
  const h = folderDialogHarness();
  const root = { name: "JOB_A", isFolder: true };
  const other = { name: "JOB_B", isFolder: true };
  let finished = false;
  const promise = h.main.promptForFolderBrowser({ initialFolder: root, tool: "SAVE PAGE" }).then(result => { finished = true; return result; });
  await h.tick();
  await h.elements.get("folderBrowserOtherBtn").fire("click"); await h.tick();
  assert.equal(h.shows, 2); assert.equal(h.pickerCalls, 1);
  assert.equal(h.elements.get("folderBrowserCurrent").textContent, "JOB_A");
  assert.equal(finished, false);
  h.setPickerResult(other);
  await h.elements.get("folderBrowserOtherBtn").fire("click"); await h.tick();
  assert.equal(h.shows, 3); assert.equal(finished, false);
  assert.equal(h.elements.get("folderBrowserCurrent").textContent, "JOB_B");
  await h.elements.get("folderBrowserSelectBtn").fire("click");
  assert.equal((await promise).folder, other);
});

test("Escape cancels confirmation and next session starts cleanly", async () => {
  const h = folderDialogHarness();
  const root = { name: "JOB_A", isFolder: true };
  for (let i = 0; i < 2; i++) {
    const promise = h.main.promptForFolderBrowser({ initialFolder: root }); await h.tick();
    await h.elements.get("folderBrowserDialog").fire("keydown", { key: "Escape" });
    assert.equal((await promise).cancelled, true);
    assert.equal(h.elements.get("folderBrowserDialog").hidden, true);
  }
});

function harness({ count = 6, placeholders = 5, moveFails = false } = {}) {
  const elements = new Map();
  let modalCalls = 0;
  let pickerCalls = 0;
  let outcome;

  const ids = [
    "openPsdBtn", "autoPhotoFillBtn", "swapPhotosBtn", "flipPhotoBtn", "savePageBtn", "saveEditedPhotosBtn", "savePsdCategoryBtn", "removePhotosBtn", "statusText", "toast",
    "savePageDialog", "savePagePrefixInput", "savePagePrefixError", "savePageDialogSaveBtn", "savePageDialogCancelBtn",
    "savePageFolderDialog", "savePageLastFolderPath", "savePageUseFolderBtn", "savePageChangeFolderBtn", "savePageFolderCancelBtn",
    "saveEditedFolderDialog", "saveEditedLastFolderPath", "saveEditedUseFolderBtn", "saveEditedChangeFolderBtn", "saveEditedFolderCancelBtn",
    "savePsdCategoryFolderDialog", "savePsdCategoryLastFolderPath", "savePsdCategoryUseFolderBtn", "savePsdCategoryChangeFolderBtn", "savePsdCategoryFolderCancelBtn",
    "savePsdCategoryDeviceDialog", "deviceLtBtn", "devicePcBtn", "deviceCustomBtn", "customDeviceInputContainer", "customDeviceInput", "savePsdCategoryDeviceSaveBtn", "savePsdCategoryDeviceCancelBtn",
    "savePsdCategoryDialog", "savePsdCategorySelect", "savePsdCustomNameInput", "savePsdDeleteOriginalCheckbox", "savePsdDeleteWarning", "savePsdDialogSaveBtn", "savePsdDialogCancelBtn",
    "savePsdOrientationDialog", "orientationLandscapeInput", "orientationPortraitInput", "orientationSquareInput", "orientationContinueBtn", "orientationCancelBtn",
    "savePsdDeleteConfirmDialog", "savePsdConfirmDeleteBtn", "savePsdCancelDeleteBtn",
    "saveResultDialog", "saveResultIcon", "saveResultTitle", "saveResultFormat", "saveResultDetails", "saveResultPath", "saveResultReason"
  ];
  for (const id of ids) {
    elements.set(id, {
      children: [], textContent: "", className: "", hidden: true, listeners: {},
      scrolls: 0, focused: false, value: "", checked: false, disabled: false,
      classList: { remove() {}, add() {} },
      get firstChild() { return this.children[0]; },
      appendChild(child) { this.children.push(child); },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      addEventListener(event, handler) { this.listeners[event] = handler; },
      showModal() { modalCalls++; return Promise.resolve("ok"); },
      close() { this.hidden = true; },
      scrollIntoView() { this.scrolls++; },
      focus() { this.focused = true; }
    });
  }

  const files = Array.from({ length: count }, (_, i) => ({
    name: "photo-" + i + ".jpg",
    nativePath: "F:\\Photos\\photo-" + i + ".jpg"
  }));

  const dependencies = {
    getSelectedLayersTopToBottom: () => Array.from({ length: placeholders }, (_, id) => ({ id })),
    readBounds: () => ({ left: 0, top: 0, right: 1200, bottom: 800 }),
    selectImageFiles: async () => { pickerCalls++; return files; },
    inspectImageFiles: async sources => ({
      photos: sources.map(file => ({ file, width: 800, height: 1200 })),
      errors: []
    }),
    runPlacement: async items => ({ placedItems: items, failedItems: [] }),
    moveUsedFiles: async sources => moveFails
      ? { moved: [], failed: sources.map(file => ({ file, error: new Error("permission denied") })) }
      : { moved: sources, failed: [] }
  };

  const context = {
    console,
    clearTimeout,
    setTimeout,
    document: {
      getElementById: id => elements.get(id) || null,
      createElement: () => ({ textContent: "" })
    },
    require: name => {
      if (name === "./src/tools/openPsd") {
        return {
          runOpenPsd: async () => ({ outcome: "success", successCount: 1, failureCount: 0 }),
          buildOpenPsdToast: () => ({ message: "1 PSD opened", type: "success" })
        };
      }
      if (name === "./src/tools/autoPhotoFill") {
        return {
          runAutoPhotoFill: async ui => {
            outcome = await executeAutoPhotoFill(ui, dependencies);
            return outcome;
          }
        };
      }
      if (name === "./src/tools/swapPhotos") {
        return {
          runSwapPhotos: async () => ({ success: true, count: 2, message: "2 photos swapped" })
        };
      }
      if (name === "./src/tools/flipPhoto") {
        return {
          runFlipPhoto: async () => ({ outcome: "success", flippedCount: 1, skippedCount: 0 })
        };
      }
      if (name === "./src/tools/savePage") {
        return {
          runSavePage: async () => ({ outcome: "success", fileName: "MMRLT1" }),
          buildSavePageToast: () => ({ message: "Saved: MMRLT1", type: "success" }),
          isValidPrefix: () => true
        };
      }
      if (name === "./src/tools/saveEditedPhotos") {
        return {
          runSaveEditedPhotos: async () => ({ outcome: "success", successCount: 1, failedCount: 0 }),
          buildSaveEditedPhotosToast: () => ({ message: "1 edited photo saved", type: "success" })
        };
      }
      if (name === "./src/tools/savePsdCategory") {
        return {
          runSavePsdCategory: async () => ({ outcome: "success", fileName: "MMR 3 PHOTOS 01 PC.psd" })
        };
      }
      if (name === "./src/tools/removePhotos") {
        return {
          runRemovePhotos: async () => ({ outcome: "success", removedCount: 1, failedCount: 0 }),
          buildRemovePhotosToast: () => ({ message: "1 photo removed", type: "success" })
        };
      }
      if (name === "./src/ui/toast") {
        return require("../src/ui/toast");
      }
      if (name === "./src/licensing/licenseManager") {
        return {
          getLicenseManager: () => ({
            initialize: async () => {},
            isOperational: () => true,
            getSnapshot: () => ({ state: "ACTIVE" })
          })
        };
      }
      throw new Error("Unexpected require: " + name);
    }
  };

  vm.runInNewContext(fs.readFileSync(require.resolve("../main"), "utf8"), context);

  return {
    elements,
    get modalCalls() { return modalCalls; },
    get pickerCalls() { return pickerCalls; },
    get outcome() { return outcome; },
    run: async () => {
      const handler = elements.get("autoPhotoFillBtn").listeners.click;
      if (handler) {
        await handler();
      }
    }
  };
}

test("real completion shows five placements plus one unused photo in the centered popup", async () => {
  const h = harness();
  await h.run();
  assert.equal(h.outcome.placedCount, 5);
  assert.equal(h.modalCalls, 1);
  assert.equal(h.elements.get("saveResultTitle").textContent, "PHOTO FILL COMPLETE");
  assert.equal(h.elements.get("saveResultFormat").textContent, "5 PHOTOS FILLED");
  assert.equal(h.elements.get("saveResultDetails").textContent, "1 PHOTO UNUSED\nAlbum Used: 5 photos moved");
  assert.equal(h.elements.get("toast").hidden, true);
  assert.equal(h.elements.get("autoPhotoFillBtn").disabled, false);
});

test("failed moves preserve completion and report the move failures in the centered popup", async () => {
  const h = harness({ moveFails: true });
  await h.run();
  assert.equal(h.modalCalls, 1);
  assert.equal(h.outcome.placedCount, 5);
  assert.equal(h.elements.get("saveResultTitle").textContent, "COMPLETED WITH ISSUES");
  assert.match(h.elements.get("saveResultDetails").textContent, /5 MOVES FAILED/);
  assert.match(h.elements.get("saveResultReason").textContent, /permission denied/);
  assert.equal(h.elements.get("toast").hidden, true);
});

test("no-placeholder warning remains readable and does not open the picker or broken modal", async () => {
  const h = harness({ placeholders: 0 });
  await h.run();
  assert.equal(h.pickerCalls, 0);
  assert.equal(h.modalCalls, 0);
  assert.equal(h.elements.get("toast").hidden, false);
  assert.equal(h.elements.get("toast").textContent, "Select one or more placeholder layers first.");
});

test("cancelling a new run updates toast and opens no completion popup", async () => {
  const h = harness({ count: 0 });
  h.elements.get("toast").hidden = false;
  h.elements.get("toast").textContent = "old result";
  await h.run();
  assert.equal(h.modalCalls, 0);
  assert.equal(h.elements.get("toast").hidden, false);
  assert.equal(h.elements.get("toast").textContent, "Cancelled.");
});
