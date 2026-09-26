"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFolderBrowser } = require("../src/folderBrowser");
const { resolveRememberedFolder } = require("../src/folderMemory");

function folder(name, nativePath = `F:/Job/${name}`) { return { name, nativePath, isFolder: true }; }
const quiet = { log() {}, error() {} };

test("remembered folder confirmation shows exact Entry and never enumerates children", async () => {
  const root = folder("JOB_A");
  Object.defineProperty(root, "getEntries", { get() { assert.fail("confirmation must not enumerate children"); } });
  const browser = createFolderBrowser({ initialFolder: root, logger: quiet });
  await browser.start();
  const state = browser.getState();
  assert.equal(state.currentFolder, root);
  assert.equal(state.currentFolderPath, "F:/Job/JOB_A");
  assert.equal(state.canSelect, true);
  assert.equal(browser.select().folder, root);
});

test("SELECT does not rewrite token; CHOOSE OTHER LOCATION replaces only after confirmation", async () => {
  const root = folder("Root"), other = folder("Other");
  const values = new Map([["key", "original"]]);
  let writes = 0;
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const fs = { getEntryForPersistentToken: async () => root, createPersistentToken: async entry => { writes++; return entry.name; } };
  const selected = await resolveRememberedFolder({ tokenKey: "key", storage, localFileSystem: fs,
    tool: "SAVE PAGE",
    browseFolder: async ({ initialFolder, tool }) => {
      assert.equal(initialFolder, root); assert.equal(tool, "SAVE PAGE");
      const browser = createFolderBrowser({ initialFolder, pickOtherLocation: async () => other, logger: quiet });
      await browser.start(); assert.equal(browser.select().folder, root); assert.equal(writes, 0);
      await browser.chooseOtherLocation(); return browser.select();
    }
  });
  assert.equal(selected, other); assert.equal(writes, 1); assert.equal(values.get("key"), "Other");
});

test("native picker cancellation retains remembered folder and confirmation can then cancel", async () => {
  const root = folder("Root");
  const browser = createFolderBrowser({ initialFolder: root, pickOtherLocation: async () => null, logger: quiet });
  await browser.start();
  assert.equal(await browser.chooseOtherLocation(), null);
  assert.equal(browser.getState().currentFolder, root);
  assert.deepEqual(browser.cancel(), { cancelled: true });
  assert.equal(browser.select(), null);
});

test("first run and stale tokens bypass confirmation and use native picker", async () => {
  const selected = folder("Selected");
  let picks = 0;
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const fs = { getFolder: async () => { picks++; return selected; }, createPersistentToken: async () => "new" };
  assert.equal(await resolveRememberedFolder({ tokenKey: "key", storage, localFileSystem: fs, selectFolder: fs.getFolder }), selected);
  assert.equal(picks, 1);
  const staleStorage = { getItem: () => "stale", setItem() {}, removeItem() {} };
  const staleFs = { getEntryForPersistentToken: async () => { throw new Error("not found"); }, getFolder: async () => selected, createPersistentToken: async () => "replacement" };
  assert.equal(await resolveRememberedFolder({ tokenKey: "key", storage: staleStorage, localFileSystem: staleFs, selectFolder: staleFs.getFolder }), selected);
});

test("confirmation is token-isolated and Shift/direct callers never invoke browser", async () => {
  const folders = [folder("Page"), folder("Edited"), folder("Category")];
  const stores = folders.map((entry, index) => ({ getItem: () => `token-${index}`, setItem() {}, removeItem() {} }));
  const fs = { getEntryForPersistentToken: async token => folders[Number(token.split("-")[1])], getFolder: async () => folders[0] };
  for (let i = 0; i < folders.length; i++) {
    let browsed = false;
    const result = await resolveRememberedFolder({ tokenKey: `key-${i}`, storage: stores[i], localFileSystem: fs,
      useRememberedDirectly: true, browseFolder: async () => { browsed = true; return null; } });
    assert.equal(result, folders[i]); assert.equal(browsed, false);
  }
});
