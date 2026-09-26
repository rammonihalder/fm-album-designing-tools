"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TOKEN_KEYS,
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  restoreFolderFromToken,
  saveFolderToken,
  getFolderDisplayPath,
  getParentFolder
} = require("../src/folderMemory");

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: key => map.delete(key),
    clear: () => map.clear(),
    _store: map
  };
}

function createMockFileSystem() {
  const persistentStore = new Map();
  const tokensByFolder = new Map();
  let tokenCounter = 1;

  return {
    async createPersistentToken(entry) {
      if (!entry) throw new Error("No entry");
      if (entry._failToken) throw new Error("Persistent token creation failed");
      const token = `token-${tokenCounter++}-${entry.name}`;
      persistentStore.set(token, entry);
      tokensByFolder.set(entry, token);
      return token;
    },
    async getEntryForPersistentToken(token) {
      if (persistentStore.has(token)) {
        const entry = persistentStore.get(token);
        if (entry._isStale) {
          throw new Error("Folder moved or inaccessible");
        }
        return entry;
      }
      const err = new Error("Token not found");
      err.code = "ENOENT";
      throw err;
    },
    async getNativePath(entry) {
      return entry.nativePath || `F:\\Mock\\${entry.name}`;
    },
    _persistentStore: persistentStore
  };
}

test("1. TOKEN_KEYS: All 5 tools have distinct, expected keys", () => {
  assert.equal(TOKEN_KEYS.OPEN_PSD, "mm_open_psd_last_folder_token");
  assert.equal(TOKEN_KEYS.AUTO_PHOTO_FILL, "mm_auto_photo_fill_last_folder_token");
  assert.equal(TOKEN_KEYS.SAVE_PAGE, "mm_save_page_last_folder_token");
  assert.equal(TOKEN_KEYS.SAVE_EDITED_PHOTOS, "mm_save_edited_photos_folder_token");
  assert.equal(TOKEN_KEYS.SAVE_PSD_CATEGORY, "mm_save_psd_category_base_folder_token");

  const keys = Object.values(TOKEN_KEYS);
  const uniqueKeys = new Set(keys);
  assert.equal(uniqueKeys.size, 5, "All 5 token keys must be distinct");
});

test("2. No token stored: restoreFolderFromToken returns null without throwing", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  for (const [tool, key] of Object.entries(TOKEN_KEYS)) {
    const folder = await restoreFolderFromToken(key, fs, storage);
    assert.equal(folder, null, `${tool} should return null when no token is stored`);
  }
});

test("3. Valid token restores the correct Folder entry", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const mockFolder = { name: "JobA_PSD", isFolder: true, isFile: false, nativePath: "F:\\JobA\\PSD" };
  const token = await saveFolderToken(TOKEN_KEYS.OPEN_PSD, mockFolder, fs, storage);

  assert.ok(token);
  assert.equal(storage.getItem(TOKEN_KEYS.OPEN_PSD), token);

  const restored = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.ok(restored);
  assert.equal(restored.name, "JobA_PSD");
});

test("4. Each tool uses only its own key and does not pollute other tools", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const openPsdFolder = { name: "PSD_Folder", isFolder: true, isFile: false };
  const autoFillFolder = { name: "Photos_Folder", isFolder: true, isFile: false };
  const savePageFolder = { name: "Album_Save_Folder", isFolder: true, isFile: false };
  const saveEditedFolder = { name: "Edited_Folder", isFolder: true, isFile: false };
  const saveCategoryFolder = { name: "Category_Base", isFolder: true, isFile: false };

  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, openPsdFolder, fs, storage);
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, autoFillFolder, fs, storage);
  await saveFolderToken(TOKEN_KEYS.SAVE_PAGE, savePageFolder, fs, storage);
  await saveFolderToken(TOKEN_KEYS.SAVE_EDITED_PHOTOS, saveEditedFolder, fs, storage);
  await saveFolderToken(TOKEN_KEYS.SAVE_PSD_CATEGORY, saveCategoryFolder, fs, storage);

  const rOpen = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  const rAuto = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  const rPage = await restoreFolderFromToken(TOKEN_KEYS.SAVE_PAGE, fs, storage);
  const rEdited = await restoreFolderFromToken(TOKEN_KEYS.SAVE_EDITED_PHOTOS, fs, storage);
  const rCategory = await restoreFolderFromToken(TOKEN_KEYS.SAVE_PSD_CATEGORY, fs, storage);

  assert.equal(rOpen.name, "PSD_Folder");
  assert.equal(rAuto.name, "Photos_Folder");
  assert.equal(rPage.name, "Album_Save_Folder");
  assert.equal(rEdited.name, "Edited_Folder");
  assert.equal(rCategory.name, "Category_Base");
});

test("5. Changing one tool does not affect any other tool's token", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const openFolder1 = { name: "PSD_Old", isFolder: true, isFile: false };
  const autoFolder = { name: "Photos_Stable", isFolder: true, isFile: false };

  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, openFolder1, fs, storage);
  await saveFolderToken(TOKEN_KEYS.AUTO_PHOTO_FILL, autoFolder, fs, storage);

  // Update OPEN PSD folder to new folder
  const openFolder2 = { name: "PSD_New", isFolder: true, isFile: false };
  await saveFolderToken(TOKEN_KEYS.OPEN_PSD, openFolder2, fs, storage);

  // Assert AUTO PHOTO FILL was not changed
  const rAuto = await restoreFolderFromToken(TOKEN_KEYS.AUTO_PHOTO_FILL, fs, storage);
  assert.equal(rAuto.name, "Photos_Stable");

  const rOpen = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, fs, storage);
  assert.equal(rOpen.name, "PSD_New");
});

test("6. Stale/inaccessible token safely clears only that tool's token and returns null", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const folder = { name: "DeletedFolder", isFolder: true, isFile: false, _isStale: true };
  const token = await saveFolderToken(TOKEN_KEYS.SAVE_PAGE, folder, fs, storage);

  assert.equal(storage.getItem(TOKEN_KEYS.SAVE_PAGE), token);

  const restored = await restoreFolderFromToken(TOKEN_KEYS.SAVE_PAGE, fs, storage);
  assert.equal(restored, null, "Should return null for stale folder");
  assert.equal(storage.getItem(TOKEN_KEYS.SAVE_PAGE), null, "Invalid token must be cleared");
});

test("7. Token pointing to non-folder entry is cleared and returns null", async () => {
  const storage = createMockStorage();
  const fs = createMockFileSystem();

  const fileAsFolder = { name: "test.txt", isFolder: false, isFile: true };
  const token = await saveFolderToken(TOKEN_KEYS.SAVE_PSD_CATEGORY, fileAsFolder, fs, storage);

  const restored = await restoreFolderFromToken(TOKEN_KEYS.SAVE_PSD_CATEGORY, fs, storage);
  assert.equal(restored, null);
  assert.equal(storage.getItem(TOKEN_KEYS.SAVE_PSD_CATEGORY), null);
});

test("8. Persistent-token creation failure does not corrupt unrelated settings or crash", async () => {
  const storage = createMockStorage({ other_setting: "keep_me" });
  const fs = createMockFileSystem();

  const brokenFolder = { name: "Broken", isFolder: true, isFile: false, _failToken: true };
  const token = await saveFolderToken(TOKEN_KEYS.SAVE_PAGE, brokenFolder, fs, storage);

  assert.equal(token, null);
  assert.equal(storage.getItem("other_setting"), "keep_me");
});

test("9. getFolderDisplayPath prefers nativePath when available, falls back to folder name", async () => {
  const fs = createMockFileSystem();

  const folderWithPath = { name: "Photos", isFolder: true, nativePath: "F:\\Wedding\\Photos" };
  const display1 = await getFolderDisplayPath(folderWithPath, fs);
  assert.equal(display1, "F:\\Wedding\\Photos");

  const folderWithoutPath = { name: "JustName", isFolder: true };
  const display2 = await getFolderDisplayPath(folderWithoutPath, {
    async getNativePath() { return null; }
  });
  assert.equal(display2, "JustName");
});

test("10. getParentFolder returns parent folder entry from fileEntry.parent", async () => {
  const mockParent = { name: "SourceFolder", isFolder: true, isFile: false };
  const mockFile = { name: "img.psd", isFile: true, parent: mockParent };

  const parent = await getParentFolder(mockFile);
  assert.equal(parent, mockParent);
});
