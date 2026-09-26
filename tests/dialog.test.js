"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { executeAutoPhotoFill } = require("../src/tools/autoPhotoFill");

function harness({ count = 6, placeholders = 5, moveFails = false } = {}) {
  const elements = new Map();
  let modalCalls = 0;
  let pickerCalls = 0;
  let outcome;

  const ids = [
    "autoPhotoFillBtn", "swapPhotosBtn", "statusText", "toast",
    "resultPanel", "resultPanelTitle", "resultPanelMessage",
    "resultDialog", "resultDialogTitle", "resultDialogMessage", "resultDialogOk"
  ];
  for (const id of ids) {
    elements.set(id, {
      children: [], textContent: "", className: "", hidden: true, listeners: {},
      scrolls: 0, focused: false,
      get firstChild() { return this.children[0]; },
      appendChild(child) { this.children.push(child); },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      addEventListener(event, handler) { this.listeners[event] = handler; },
      showModal() { modalCalls++; return Promise.resolve("ok"); },
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
      if (name === "./src/ui/toast") {
        return require("../src/ui/toast");
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
    run: () => elements.get("autoPhotoFillBtn").listeners.click()
  };
}

test("real completion shows five placements plus one extra in the panel without any popup", async () => {
  const h = harness();
  await h.run();
  assert.equal(h.outcome.placedCount, 5);
  assert.equal(h.modalCalls, 0);
  assert.equal(h.elements.get("toast").hidden, false);
  assert.equal(h.elements.get("toast").textContent, "5 photos filled • 1 skipped");
  assert.equal(h.elements.get("autoPhotoFillBtn").disabled, false);
});

test("failed moves preserve completion and report the move failures in toast without a popup", async () => {
  const h = harness({ moveFails: true });
  await h.run();
  assert.equal(h.modalCalls, 0);
  assert.equal(h.outcome.placedCount, 5);
  assert.equal(h.elements.get("toast").hidden, false);
  assert.equal(h.elements.get("toast").textContent, "5 photos filled • 1 skipped • 5 moves failed");
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
