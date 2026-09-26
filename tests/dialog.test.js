"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { executeAutoPhotoFill } = require("../src/tools/autoPhotoFill");

function harness({ count = 6, placeholders = 5, moveFails = false, scrollThrows = false } = {}) {
  const elements = new Map();
  let modalCalls = 0;
  let pickerCalls = 0;
  let outcome;
  // Include old dialog nodes so this test catches actual popup invocation in v0.2.1.
  const ids = ["autoPhotoFillBtn", "statusText", "resultPanel", "resultPanelTitle", "resultPanelMessage",
    "resultDialog", "resultDialogTitle", "resultDialogMessage", "resultDialogOk"];
  for (const id of ids) {
    elements.set(id, {
      children: [], textContent: "", hidden: id === "resultPanel", listeners: {},
      scrolls: 0, focused: false,
      get firstChild() { return this.children[0]; },
      appendChild(child) { this.children.push(child); },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      addEventListener(event, handler) { this.listeners[event] = handler; },
      showModal() { modalCalls++; return Promise.resolve("ok"); },
      scrollIntoView() { this.scrolls++; if (scrollThrows) throw new Error("unsupported scroll"); },
      focus() { this.focused = true; }
    });
  }
  const files = Array.from({ length: count }, (_, i) => ({ name: "photo-" + i + ".jpg", nativePath: "F:\\Photos\\photo-" + i + ".jpg" }));
  const dependencies = {
    getSelectedLayersTopToBottom: () => Array.from({ length: placeholders }, (_, id) => ({ id })),
    readBounds: () => ({ left: 0, top: 0, right: 1200, bottom: 800 }),
    selectImageFiles: async () => { pickerCalls++; return files; },
    inspectImageFiles: async sources => ({ photos: sources.map(file => ({ file, width: 800, height: 1200 })), errors: [] }),
    runPlacement: async items => ({ placedItems: items, failedItems: [] }),
    moveUsedFiles: async sources => moveFails
      ? { moved: [], failed: sources.map(file => ({ file, error: new Error("permission denied") })) }
      : { moved: sources, failed: [] }
  };
  const context = {
    console,
    document: { getElementById: id => elements.get(id) || null, createElement: () => ({ textContent: "" }) },
    require: name => {
      assert.equal(name, "./src/tools/autoPhotoFill");
      return { runAutoPhotoFill: async ui => { outcome = await executeAutoPhotoFill(ui, dependencies); } };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../main"), "utf8"), context);
  return {
    elements,
    get modalCalls() { return modalCalls; },
    get pickerCalls() { return pickerCalls; },
    get outcome() { return outcome; },
    lines: () => elements.get("resultPanelMessage").children.map(p => p.textContent),
    run: () => elements.get("autoPhotoFillBtn").listeners.click()
  };
}

test("real completion shows five placements plus one extra in the panel without any popup", async () => {
  const h = harness();
  await h.run();
  assert.equal(h.outcome.placedCount, 5);
  assert.equal(h.modalCalls, 0);
  assert.equal(h.elements.get("statusText").textContent, "Complete.");
  assert.equal(h.elements.get("resultPanel").hidden, false);
  assert.equal(h.elements.get("resultPanelTitle").textContent, "Auto Photo Fill Complete");
  assert.deepEqual(h.lines(), ["5 photos placed successfully.", "All selected placeholders were filled.", "1 photo skipped."]);
  assert.equal(h.elements.get("autoPhotoFillBtn").disabled, false);
  assert.ok(h.elements.get("resultPanel").scrolls > 0);
});

test("failed moves preserve Complete and report the count before file details without a popup", async () => {
  const h = harness({ moveFails: true });
  await h.run();
  assert.equal(h.modalCalls, 0);
  assert.equal(h.outcome.placedCount, 5);
  assert.equal(h.elements.get("statusText").textContent, "Complete.");
  const lines = h.lines();
  const countIndex = lines.indexOf("5 source photos could not be moved to Album Used.");
  assert.ok(countIndex >= 0);
  assert.ok(lines.findIndex(line => line.startsWith("Could not move")) > countIndex);
});

test("optional scrolling failure cannot hide the result or alter Complete", async () => {
  const h = harness({ scrollThrows: true });
  await h.run();
  assert.equal(h.modalCalls, 0);
  assert.equal(h.elements.get("statusText").textContent, "Complete.");
  assert.equal(h.elements.get("resultPanel").hidden, false);
  assert.equal(h.lines()[0], "5 photos placed successfully.");
});

test("no-placeholder warning remains readable and does not open the picker or broken modal", async () => {
  const h = harness({ placeholders: 0 });
  await h.run();
  assert.equal(h.pickerCalls, 0);
  assert.equal(h.modalCalls, 0);
  assert.deepEqual(h.lines(), ["Select one or more placeholder layers first."]);
});

test("cancelling a new run clears the old result and opens no completion popup", async () => {
  const h = harness({ count: 0 });
  h.elements.get("resultPanel").hidden = false;
  h.elements.get("resultPanelMessage").children.push({ textContent: "old result" });
  await h.run();
  assert.equal(h.modalCalls, 0);
  assert.equal(h.elements.get("statusText").textContent, "Cancelled.");
  assert.equal(h.elements.get("resultPanel").hidden, true);
});
