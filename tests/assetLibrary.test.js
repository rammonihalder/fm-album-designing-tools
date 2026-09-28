"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ASSET_LIBRARY_ROOT_KEY,
  ASSET_CATEGORIES,
  DEFAULT_CATEGORY,
  validateCategory,
  validateRoot,
  resolveAssetLibraryRoot,
  changeAssetLibraryRoot,
  ensureCategoryFolder,
  reserveAssetFile
} = require("../src/tools/assetLibrary");

function makeFolder(name, entries = []) {
  return {
    name,
    nativePath: `D:/Memory Maker/PNG Assets/${name}`,
    isFolder: true,
    entries: [...entries],
    createdFolders: [],
    createdFiles: [],
    async getEntries() {
      return this.entries;
    },
    async createFolder(childName) {
      const child = makeFolder(childName);
      this.entries.push(child);
      this.createdFolders.push(childName);
      return child;
    },
    async createFile(fileName, options = {}) {
      if (options.overwrite === false && this.entries.some(e => e.name.toLowerCase() === fileName.toLowerCase())) {
        throw new Error("File already exists");
      }
      const file = {
        name: fileName,
        isFile: true,
        isFolder: false,
        deleted: false,
        async delete() { this.deleted = true; }
      };
      this.entries.push(file);
      this.createdFiles.push(fileName);
      return file;
    }
  };
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    has: k => map.has(k)
  };
}

function makeLfs(tokenMap = new Map()) {
  return {
    tokens: tokenMap,
    async getEntryForPersistentToken(token) {
      if (!this.tokens.has(token)) throw new Error("Stale token");
      return this.tokens.get(token);
    },
    async createPersistentToken(entry) {
      const token = `token:${entry.name}`;
      this.tokens.set(token, entry);
      return token;
    },
    async getNativePath(entry) {
      return entry.nativePath || `D:/Memory Maker/PNG Assets/${entry.name}`;
    }
  };
}

test("6. ADD ASSET and SAVE ASSET share the exact same root key", () => {
  assert.equal(ASSET_LIBRARY_ROOT_KEY, "mm_asset_library_root_folder_token");
});

test("7. First use shows SET FOLDER (no root configured)", async () => {
  const storage = makeStorage();
  const lfs = makeLfs();
  const resolved = await resolveAssetLibraryRoot({ localFileSystem: lfs, storage });
  assert.equal(resolved.folder, null);
});

test("8. Successful root selection is remembered", async () => {
  const storage = makeStorage();
  const lfs = makeLfs();
  const root = makeFolder("PNG Assets");
  lfs.getFolder = async () => root;

  const result = await changeAssetLibraryRoot({ localFileSystem: lfs, storage });
  assert.equal(result.changed, true);
  assert.equal(result.folder, root);
  assert.ok(storage.has(ASSET_LIBRARY_ROOT_KEY));

  const secondResolved = await resolveAssetLibraryRoot({ localFileSystem: lfs, storage });
  assert.equal(secondResolved.folder?.name, "PNG Assets");
});

test("9. CHANGE FOLDER updates root only after successful selection", async () => {
  const storage = makeStorage();
  const lfs = makeLfs();
  const root1 = makeFolder("PNG Assets 1");
  const root2 = makeFolder("PNG Assets 2");

  lfs.getFolder = async () => root1;
  await changeAssetLibraryRoot({ localFileSystem: lfs, storage });
  assert.equal(storage.getItem(ASSET_LIBRARY_ROOT_KEY), "token:PNG Assets 1");

  lfs.getFolder = async () => root2;
  const result = await changeAssetLibraryRoot({ localFileSystem: lfs, storage, currentFolder: root1 });
  assert.equal(result.changed, true);
  assert.equal(result.folder, root2);
  assert.equal(storage.getItem(ASSET_LIBRARY_ROOT_KEY), "token:PNG Assets 2");
});

test("10. Cancel preserves old root folder and token", async () => {
  const storage = makeStorage();
  const lfs = makeLfs();
  const root1 = makeFolder("PNG Assets 1");

  lfs.getFolder = async () => root1;
  await changeAssetLibraryRoot({ localFileSystem: lfs, storage });

  lfs.getFolder = async () => null; // user cancelled
  const result = await changeAssetLibraryRoot({ localFileSystem: lfs, storage, currentFolder: root1 });
  assert.equal(result.cancelled, true);
  assert.equal(result.changed, false);
  assert.equal(result.folder, root1);
  assert.equal(storage.getItem(ASSET_LIBRARY_ROOT_KEY), "token:PNG Assets 1");
});

test("11. Stale token clears only shared asset root without affecting other tools", async () => {
  const storage = makeStorage({
    [ASSET_LIBRARY_ROOT_KEY]: "stale_token",
    mm_add_frame_root_folder_token: "frame_token",
    mm_save_frame_root_folder_token: "save_frame_token",
    mm_png_mask_folder_token: "mask_token"
  });
  const lfs = makeLfs(); // empty token map, so getEntryForPersistentToken throws

  const resolved = await resolveAssetLibraryRoot({ localFileSystem: lfs, storage });
  assert.equal(resolved.folder, null);
  assert.equal(storage.has(ASSET_LIBRARY_ROOT_KEY), false);
  assert.equal(storage.has("mm_add_frame_root_folder_token"), true);
  assert.equal(storage.has("mm_save_frame_root_folder_token"), true);
  assert.equal(storage.has("mm_png_mask_folder_token"), true);
});

test("12. All five categories exist", () => {
  assert.deepEqual(ASSET_CATEGORIES, [
    "PNG TEXT",
    "PNG ASSET",
    "DECORATION",
    "PNG BORDER",
    "PNG MASK"
  ]);
});

test("13. Default category is PNG ASSET", () => {
  assert.equal(DEFAULT_CATEGORY, "PNG ASSET");
  assert.equal(validateCategory(undefined), "PNG ASSET");
  assert.equal(validateCategory(""), "PNG ASSET");
  assert.equal(validateCategory("PNG TEXT"), "PNG TEXT");
  assert.throws(() => validateCategory("INVALID_CAT"), /Choose a valid asset category/);
});

test("14. Correct category folder path is resolved / generated", async () => {
  const root = makeFolder("PNG Assets");
  const catFolder = await ensureCategoryFolder(root, "DECORATION");
  assert.equal(catFolder.name, "DECORATION");
});

test("15. Missing category folder is created automatically", async () => {
  const root = makeFolder("PNG Assets", []);
  assert.equal(root.entries.length, 0);

  const catFolder = await ensureCategoryFolder(root, "PNG BORDER");
  assert.equal(catFolder.name, "PNG BORDER");
  assert.ok(root.createdFolders.includes("PNG BORDER"));
  assert.equal(root.entries.length, 1);

  // Calling again returns existing folder without creating a second one
  const existingCatFolder = await ensureCategoryFolder(root, "PNG BORDER");
  assert.equal(existingCatFolder, catFolder);
  assert.equal(root.createdFolders.length, 1);
});

test("16. Category folders are independent", async () => {
  const root = makeFolder("PNG Assets");
  const folderText = await ensureCategoryFolder(root, "PNG TEXT");
  const folderDeco = await ensureCategoryFolder(root, "DECORATION");

  assert.notEqual(folderText, folderDeco);
  assert.equal(folderText.name, "PNG TEXT");
  assert.equal(folderDeco.name, "DECORATION");
});

test("Category-specific prefixes: PNG TEXT, PNG ASSET, DECORATION, PNG BORDER, PNG MASK", async () => {
  const textFolder = makeFolder("PNG TEXT", []);
  const assetFolder = makeFolder("PNG ASSET", []);
  const decoFolder = makeFolder("DECORATION", []);
  const borderFolder = makeFolder("PNG BORDER", []);
  const maskFolder = makeFolder("PNG MASK", []);

  assert.equal((await reserveAssetFile(textFolder, "PNG TEXT")).name, "mm_text01.png");
  assert.equal((await reserveAssetFile(assetFolder, "PNG ASSET")).name, "mm_asset01.png");
  assert.equal((await reserveAssetFile(decoFolder, "DECORATION")).name, "mm_decoration01.png");
  assert.equal((await reserveAssetFile(borderFolder, "PNG BORDER")).name, "mm_border01.png");
  assert.equal((await reserveAssetFile(maskFolder, "PNG MASK")).name, "mm_mask01.png");
});

test("2-digit zero padding: 01 -> 02, 09 -> 10, and 99 -> 100 sequencing", async () => {
  const folder01 = makeFolder("PNG TEXT", [
    { name: "mm_text01.png", isFile: true }
  ]);
  assert.equal((await reserveAssetFile(folder01, "PNG TEXT")).name, "mm_text02.png");

  const folder09 = makeFolder("PNG ASSET", [
    { name: "mm_asset09.png", isFile: true }
  ]);
  assert.equal((await reserveAssetFile(folder09, "PNG ASSET")).name, "mm_asset10.png");

  const folder99 = makeFolder("DECORATION", [
    { name: "mm_decoration99.png", isFile: true }
  ]);
  assert.equal((await reserveAssetFile(folder99, "DECORATION")).name, "mm_decoration100.png");

  const folder100 = makeFolder("DECORATION", [
    { name: "mm_decoration100.png", isFile: true }
  ]);
  assert.equal((await reserveAssetFile(folder100, "DECORATION")).name, "mm_decoration101.png");
});

test("Numbering is per-category and independent", async () => {
  const textFolder = makeFolder("PNG TEXT", [
    { name: "mm_text01.png", isFile: true },
    { name: "mm_text02.png", isFile: true }
  ]);
  const decoFolder = makeFolder("DECORATION", [
    { name: "mm_decoration01.png", isFile: true }
  ]);
  const maskFolder = makeFolder("PNG MASK", []);

  assert.equal((await reserveAssetFile(textFolder, "PNG TEXT")).name, "mm_text03.png");
  assert.equal((await reserveAssetFile(decoFolder, "DECORATION")).name, "mm_decoration02.png");
  assert.equal((await reserveAssetFile(maskFolder, "PNG MASK")).name, "mm_mask01.png");
});

test("Unrelated PNG files in folder are ignored when determining next serial", async () => {
  const textFolder = makeFolder("PNG TEXT", [
    { name: "old-design.png", isFile: true },
    { name: "sample.png", isFile: true },
    { name: "mm_text01.png", isFile: true },
    { name: "mm_text02.png", isFile: true },
    { name: "mm_decoration99.png", isFile: true } // different category pattern ignored
  ]);

  const nextText = await reserveAssetFile(textFolder, "PNG TEXT");
  assert.equal(nextText.name, "mm_text03.png");
});

test("Existing matching files are never overwritten", async () => {
  const assetFolder = makeFolder("PNG ASSET", [
    { name: "mm_asset01.png", isFile: true },
    { name: "mm_asset02.png", isFile: true },
    { name: "mm_asset14.png", isFile: true }
  ]);

  const next = await reserveAssetFile(assetFolder, "PNG ASSET");
  assert.equal(next.name, "mm_asset15.png");
});
