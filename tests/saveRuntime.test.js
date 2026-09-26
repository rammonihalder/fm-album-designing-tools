"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Run the public entrypoints with real project modules; only the UXP/Photoshop
// host boundary is simulated. Executor-only tests missed the runtime wiring bugs.
function runtime() {
  const values = new Map();
  const tokens = new Map();
  const calls = { picker: 0, saves: [], closed: [], dialogs: 0, logs: [], modal: 0 };
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  function folder(name) {
    const entries = new Map();
    return {
      name, isFolder: true, nativePath: `F:/Test/${name}`, entries,
      getEntries: async () => [...entries.values()],
      getEntry: async name => {
        if (!entries.has(name)) throw new Error("Entry not found");
        return entries.get(name);
      },
      createFolder: async name => {
        const child = folder(name);
        entries.set(name, child);
        return child;
      },
      createFile: async (fileName, opts) => {
        assert.equal(opts.overwrite, false);
        assert.equal(entries.has(fileName), false);
        const entry = { name: fileName, isFile: true, nativePath: `F:/Test/${name}/${fileName}` };
        entries.set(fileName, entry);
        return entry;
      }
    };
  }
  const destination = folder("Destination");
  const localFileSystem = {
    getFolder: async () => { calls.picker++; return destination; },
    createPersistentToken: async entry => {
      const token = `token-${tokens.size + 1}`;
      tokens.set(token, entry);
      return token;
    },
    getEntryForPersistentToken: async token => {
      if (!tokens.has(token)) throw new Error("Stale token");
      return tokens.get(token);
    }
  };
  const app = { documents: [], activeDocument: null };
  function document(id) {
    const layer = { id: id * 10, name: "Photo", kind: "smartObject", bounds: { left: 0, top: 0, right: 200, bottom: 100 } };
    const doc = {
      id, name: `Doc${id}.psd`, activeLayers: [layer], layers: [layer],
      saveAs: Object.fromEntries(["psd", "jpg"].map(format => [format, async (entry, options, asCopy) => {
        assert.ok(calls.modal > 0, "save must run inside Photoshop modal scope");
        calls.saves.push({ id, format, entry, options, asCopy });
      }])),
      closeWithoutSaving: async () => {
        assert.ok(calls.modal > 0, "close must run inside Photoshop modal scope");
        calls.closed.push(id);
        app.documents = app.documents.filter(d => d.id !== id);
      }
    };
    app.documents.push(doc);
    app.activeDocument = doc;
    return doc;
  }
  const source = document(7);
  const photoshop = {
    app, constants: { SaveOptions: { DONOTSAVECHANGES: 2 } },
    core: { executeAsModal: async fn => {
      calls.modal++;
      try { return await fn({}); } finally { calls.modal--; }
    } },
    action: { batchPlay: async descriptors => {
      if (descriptors.some(d => d._obj === "placedLayerEditContents")) document(99);
      return [{}];
    } }
  };
  const cache = new Map();
  function load(file) {
    const absolute = path.resolve(__dirname, "..", file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const context = {
      module, exports: module.exports, localStorage: storage,
      console: { log: (...args) => calls.logs.push(args), warn() {}, error() {} },
      setTimeout, clearTimeout,
      require: request => {
        if (request === "photoshop") return photoshop;
        if (request === "uxp") return { storage: { localFileSystem } };
        if (request.startsWith(".")) return load(path.resolve(path.dirname(absolute), request + ".js"));
        return require(request);
      }
    };
    vm.runInNewContext(fs.readFileSync(absolute, "utf8"), context, { filename: absolute });
    return module.exports;
  }
  return { load, calls, values, tokens, storage, localFileSystem, app, source, folder, destination, document };
}

const tools = [
  ["savePage", "runSavePage", "mm_save_page_last_folder_token"],
  ["saveEditedPhotos", "runSaveEditedPhotos", "mm_save_edited_photos_folder_token"],
  ["savePsdCategory", "runSavePsdCategory", "mm_save_psd_category_base_folder_token"]
];

for (const [tool, runner, key] of tools) {
  function options(h, extra = {}) {
    return {
      promptForPrefix: async () => ({ prefix: "Bride" }),
      promptForDeviceType: async () => ({ deviceType: "DT" }),
      promptForDeviceName: async () => ({ deviceName: "PC" }),
      promptForCategoryOptions: async () => ({ category: "3 PHOTOS PSD", deleteOriginal: false }),
      promptForOrientationCheck: async () => ({ landscapeCount: 1, portraitCount: 0, squareCount: 0 }),
      browseFolder: async ({ initialFolder }) => { h.calls.dialogs++; return { folder: initialFolder }; },
      ...extra
    };
  }
  test(`${tool}: public runner saves from actual active document and persists first folder`, async () => {
    const h = runtime();
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h));
    assert.equal(result.outcome, "success");
    assert.equal(h.calls.picker, 1);
    assert.equal(h.tokens.get(h.values.get(key)), h.destination);
    assert.equal(h.calls.dialogs, 0);
    assert.ok(h.calls.saves.every(s => s.asCopy === true));
    assert.ok(h.calls.saves.filter(s => s.format === "jpg").every(s => s.options.quality === 12));
    if (tool === "savePsdCategory") {
      assert.equal(h.calls.saves[0].id, 7);
      assert.deepEqual(h.calls.closed, [7]);
      assert.equal(h.calls.saves[0].options.layers, true);
    } else assert.ok(h.app.documents.includes(h.source));
  });
  test(`${tool}: Shift remembered folder bypasses browser and picker`, async () => {
    const h = runtime();
    const remembered = h.folder("Remembered");
    h.tokens.set("valid", remembered);
    h.values.set(key, "valid");
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h, { useRememberedDirectly: true }));
    assert.equal(result.outcome, "success");
    assert.equal(h.calls.picker, 0);
    assert.equal(h.calls.dialogs, 0);
    assert.ok(remembered.entries.size > 0);
  });
  test(`${tool}: normal browser starts at exact restored Entry and replaces only its own destination`, async () => {
    const h = runtime();
    for (const [, , otherKey] of tools) h.values.set(otherKey, "valid");
    h.tokens.set("valid", h.folder("Old"));
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h, { browseFolder: async ({ initialFolder }) => { assert.equal(initialFolder, h.tokens.get("valid")); h.calls.dialogs++; return { folder: h.destination }; } }));
    assert.equal(result.outcome, "success");
    assert.equal(h.calls.picker, 0);
    assert.equal(h.tokens.get(h.values.get(key)), h.destination);
    for (const [, , otherKey] of tools) if (otherKey !== key) assert.equal(h.values.get(otherKey), "valid");
    if (!h.app.documents.includes(h.source)) h.document(17);
    const next = await h.load(`src/tools/${tool}.js`)[runner](options(h));
    assert.equal(next.outcome, "success");
    assert.equal(h.calls.picker, 0, "next normal run uses new folder without picking");
    assert.equal(h.calls.dialogs, 2);
  });
  test(`${tool}: cancelled browser preserves valid token and saves nothing`, async () => {
    const h = runtime();
    h.tokens.set("valid", h.folder("Old")); h.values.set(key, "valid");
    h.values.set("mm_edited_photos_device_type", "DT");
    h.localFileSystem.getFolder = async () => { h.calls.picker++; return null; };
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h, { browseFolder: async () => ({ cancelled: true }) }));
    assert.equal(result.outcome, "cancelled");
    assert.equal(h.calls.picker, 0);
    assert.equal(h.values.get(key), "valid");
    assert.equal(h.calls.saves.length, 0);
  });
  test(`${tool}: stale token falls back to picker and persists replacement`, async () => {
    const h = runtime(); h.values.set(key, "stale");
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h));
    assert.equal(result.outcome, "success");
    assert.equal(h.calls.picker, 1);
    assert.equal(h.tokens.get(h.values.get(key)), h.destination);
  });
  test(`${tool}: Shift without token falls back to native picker`, async () => {
    const h = runtime();
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h, { useRememberedDirectly: true }));
    assert.equal(result.outcome, "success");
    assert.equal(h.calls.picker, 1);
    assert.equal(h.calls.dialogs, 0);
    assert.equal(h.tokens.get(h.values.get(key)), h.destination);
  });
  test(`${tool}: confirmed browser folder is usable when token creation fails`, async () => {
    const h = runtime();
    h.tokens.set("valid", h.folder("Old")); h.values.set(key, "valid");
    h.localFileSystem.createPersistentToken = async () => { throw new Error("Token creation denied"); };
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h, { browseFolder: async () => ({ folder: h.destination }) }));
    assert.equal(result.outcome, "success");
    assert.equal(h.values.get(key), "valid");
    assert.equal(h.calls.picker, 0);
    assert.ok(h.destination.entries.size > 0);
  });
  test(`${tool}: stale token plus picker cancellation clears only its own token`, async () => {
    const h = runtime();
    for (const [, , otherKey] of tools) h.values.set(otherKey, "stale");
    h.localFileSystem.getFolder = async () => null;
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h));
    assert.equal(result.outcome, "cancelled");
    assert.equal(h.values.has(key), false);
    for (const [, , otherKey] of tools) if (otherKey !== key) assert.equal(h.values.get(otherKey), "stale");
    assert.equal(h.calls.saves.length, 0);
  });
  test(`${tool}: resolved but inaccessible folder falls back to picker`, async () => {
    const h = runtime();
    const inaccessible = h.folder("Gone");
    inaccessible.getEntries = async () => { throw new Error("Folder deleted"); };
    h.tokens.set("gone", inaccessible); h.values.set(key, "gone");
    const result = await h.load(`src/tools/${tool}.js`)[runner](options(h));
    assert.equal(result.outcome, "success");
    assert.equal(h.calls.picker, 1);
    assert.equal(h.tokens.get(h.values.get(key)), h.destination);
  });
}

test("SAVE PAGE migrates valid old key once, before a cancelled prefix dialog", async () => {
  const h = runtime();
  h.tokens.set("legacy", h.folder("Legacy"));
  h.values.set("mm_save_page_base_folder_token", "legacy");
  const run = h.load("src/tools/savePage.js").runSavePage;
  assert.equal((await run({ useRememberedDirectly: true, promptForPrefix: async () => ({ cancelled: true }) })).outcome, "cancelled");
  assert.equal(h.calls.picker, 0);
  assert.equal(h.values.get("mm_save_page_last_folder_token"), "legacy");
  assert.equal(h.values.has("mm_save_page_base_folder_token"), false);
  assert.equal((await run({ useRememberedDirectly: true, promptForPrefix: async () => ({ prefix: "" }) })).outcome, "success");
  assert.equal(h.calls.picker, 0);
});

test("SAVE PAGE canonical token takes precedence over legacy token", async () => {
  const h = runtime();
  const canonical = h.folder("Canonical");
  h.tokens.set("new", canonical); h.tokens.set("old", h.folder("Old"));
  h.values.set("mm_save_page_last_folder_token", "new");
  h.values.set("mm_save_page_base_folder_token", "old");
  const result = await h.load("src/tools/savePage.js").runSavePage({ useRememberedDirectly: true });
  assert.equal(result.outcome, "success");
  assert.ok(canonical.entries.has("PSD"));
  assert.equal(h.calls.picker, 0);
});

test("SAVE PAGE stale legacy token is cleared; first replacement survives prefix cancel", async () => {
  const h = runtime();
  h.values.set("mm_save_page_base_folder_token", "stale");
  const result = await h.load("src/tools/savePage.js").runSavePage({ promptForPrefix: async () => ({ cancelled: true }) });
  assert.equal(result.outcome, "cancelled");
  assert.equal(h.calls.picker, 1);
  assert.equal(h.values.has("mm_save_page_base_folder_token"), false);
  assert.equal(h.tokens.get(h.values.get("mm_save_page_last_folder_token")), h.destination);
  assert.equal(h.calls.saves.length, 0);
});

test("SAVE PAGE cancelled browser after migration preserves remembered folder", async () => {
  const h = runtime();
  h.tokens.set("old", h.folder("Old")); h.values.set("mm_save_page_base_folder_token", "old");
  h.localFileSystem.getFolder = async () => { h.calls.picker++; return null; };
  const result = await h.load("src/tools/savePage.js").runSavePage({ browseFolder: async () => ({ cancelled: true }) });
  assert.equal(result.outcome, "cancelled");
  assert.equal(h.calls.picker, 0);
  assert.equal(h.values.get("mm_save_page_last_folder_token"), "old");
  assert.equal(h.calls.saves.length, 0);
});

test("SAVE PSD CATEGORY empty custom device becomes CUSTOM and all counts 3-12 auto-select", async () => {
  const h = runtime();
  const category = h.load("src/tools/savePsdCategory.js");
  for (let count = 3; count <= 12; count++) {
    h.source.activeLayers = Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
    const result = await category.runSavePsdCategory({
      useRememberedDirectly: true,
      promptForDeviceName: async () => ({ deviceName: "" }),
      promptForCategoryOptions: async opts => {
        assert.equal(opts.defaultCategory, `${count} PHOTOS PSD`);
        return { cancelled: true };
      }
    });
    assert.equal(result.outcome, "cancelled");
    assert.equal(h.values.get("mm_save_psd_category_device_name"), "CUSTOM");
  }
});

test("SAVE PSD CATEGORY failed output never confirms deletion or closes source", async () => {
  const h = runtime();
  h.source.saveAs.psd = async () => { throw new Error("Disk full"); };
  let confirmations = 0;
  const result = await h.load("src/tools/savePsdCategory.js").runSavePsdCategory({
    promptForCategoryOptions: async () => ({ deleteOriginal: true }),
    promptForDeleteConfirmation: async () => { confirmations++; return { confirmed: true }; }
  });
  assert.equal(result.outcome, "psd-failed");
  assert.equal(confirmations, 0);
  assert.equal(h.calls.closed.length, 0);
});

test("SAVE PSD CATEGORY resolves actual source path and deletes only after save and close", async () => {
  const h = runtime();
  h.source.path = "F:\\Source\\Original.psd";
  let deleted = false;
  h.localFileSystem.getEntryWithUrl = async url => {
    assert.equal(url, "file:/F:/Source/Original.psd");
    return { name: "Original.psd", isFile: true, nativePath: h.source.path, delete: async () => {
      assert.equal(h.calls.saves.length, 1);
      assert.deepEqual(h.calls.closed, [7]);
      deleted = true;
    } };
  };
  const result = await h.load("src/tools/savePsdCategory.js").runSavePsdCategory({
    promptForCategoryOptions: async () => ({ deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: true })
  });
  assert.equal(result.outcome, "saved-original-deleted");
  assert.equal(deleted, true);
});

test("SAVE PSD CATEGORY can delete a same-named original in a different folder", async () => {
  const h = runtime();
  h.source.path = "F:/Source/1L_MMR 3 PHOTOS 01 PC.psd";
  let deleted = false;
  h.localFileSystem.getEntryWithUrl = async () => ({
    name: "1L_MMR 3 PHOTOS 01 PC.psd", nativePath: h.source.path, isFile: true,
    delete: async () => { deleted = true; }
  });
  const result = await h.load("src/tools/savePsdCategory.js").runSavePsdCategory({
    promptForCategoryOptions: async () => ({ deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: true })
  });
  assert.equal(result.outcome, "saved-original-deleted");
  assert.equal(deleted, true);
  assert.ok(h.destination.entries.get("3 PHOTOS PSD").entries.has("1L_MMR 3 PHOTOS 01 PC.psd"));
});

test("SAVE PSD CATEGORY leaves original intact when closing source fails", async () => {
  const h = runtime();
  h.source.path = "F:/Source/Original.psd";
  h.source.closeWithoutSaving = async () => { throw new Error("Close failed"); };
  let deleted = false;
  h.localFileSystem.getEntryWithUrl = async () => ({
    name: "Original.psd", nativePath: h.source.path, isFile: true,
    delete: async () => { deleted = true; }
  });
  const result = await h.load("src/tools/savePsdCategory.js").runSavePsdCategory({
    promptForCategoryOptions: async () => ({ deleteOriginal: true }),
    promptForDeleteConfirmation: async () => ({ confirmed: true })
  });
  assert.equal(result.outcome, "saved-delete-failed");
  assert.equal(deleted, false);
  assert.equal(h.calls.saves.length, 1);
});

test("SAVE PSD CATEGORY has no-document only when no document is open", async () => {
  const h = runtime(); h.app.documents = [];
  Object.defineProperty(h.app, "activeDocument", { get() { throw new Error("No active document"); } });
  const result = await h.load("src/tools/savePsdCategory.js").runSavePsdCategory();
  assert.equal(result.outcome, "no-document");
  assert.equal(h.calls.picker, 0);
  const log = h.calls.logs.find(args => args[0] === "[SAVE PSD CATEGORY] document check");
  assert.equal(log?.[1].documentsCount, 0);
});

test("SAVE PSD CATEGORY captures stable ID before picker changes active document", async () => {
  const h = runtime();
  h.localFileSystem.getFolder = async () => { h.document(8); return h.destination; };
  const result = await h.load("src/tools/savePsdCategory.js").runSavePsdCategory();
  assert.equal(result.outcome, "success");
  assert.equal(h.calls.saves[0].id, 7);
  assert.deepEqual(h.calls.closed, [7]);
});

for (const [tool, , key] of tools) {
  test(`${tool}: main forwards Shift for click, Enter and Space with disabled locks`, async () => {
    const h = runtime();
    h.tokens.set("valid", h.folder("Old")); h.values.set(key, "valid");
    h.values.set("mm_edited_photos_device_type", "DT");
    const main = h.load("main.js");
    const listeners = {};
    const element = { disabled: false, addEventListener: (name, fn) => { listeners[name] = fn; } };
    const handler = main[`handle${tool[0].toUpperCase()}${tool.slice(1)}`];
    main.attachActionHandler(element, handler);
    h.localFileSystem.getFolder = async () => { h.calls.picker++; return null; };
    for (const keyName of [null, "Enter", " "]) {
      if (!h.app.documents.length) h.document(7);
      const before = h.calls.saves.length;
      const result = keyName === null
        ? await listeners.click({ shiftKey: true })
        : await listeners.keydown({ key: keyName, shiftKey: true, preventDefault() {} });
      // Category/prefix dialogs without a DOM may cancel AFTER destination
      // resolution; other tools complete. No folder picker is permitted.
      assert.notEqual(result.outcome, "error");
      assert.equal(h.calls.picker, 0);
      if (tool === "saveEditedPhotos") assert.ok(h.calls.saves.length > before);
    }
    element.disabled = true;
    const before = h.calls.saves.length;
    await listeners.click({ shiftKey: true, preventDefault() {} });
    await listeners.keydown({ key: "Enter", shiftKey: true, preventDefault() {} });
    assert.equal(h.calls.saves.length, before);
    assert.equal(h.calls.picker, 0);
  });
}
