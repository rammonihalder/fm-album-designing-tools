"use strict";
const {
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  restoreFolderFromToken,
  saveFolderToken,
  getFolderDisplayPath
} = require("../folderMemory");

const ASSET_LIBRARY_ROOT_KEY = "mm_asset_library_root_folder_token";

const ASSET_CATEGORIES = Object.freeze([
  "PNG TEXT",
  "PNG ASSET",
  "DECORATION",
  "PNG BORDER",
  "PNG MASK"
]);

const DEFAULT_CATEGORY = "PNG ASSET";

function validateCategory(category) {
  if (!category || !String(category).trim()) return DEFAULT_CATEGORY;
  const normalized = String(category).trim().toUpperCase();
  const match = ASSET_CATEGORIES.find(cat => cat === normalized);
  if (!match) {
    throw new Error(`Choose a valid asset category: ${ASSET_CATEGORIES.join(", ")}.`);
  }
  return match;
}

async function validateRoot(folder) {
  if (folder?.isFolder !== true || typeof folder.getEntries !== "function") {
    throw new Error("Select a readable asset library folder.");
  }
  await folder.getEntries();
}

async function resolveAssetLibraryRoot({ localFileSystem, storage } = {}) {
  if (!getStoredValue(ASSET_LIBRARY_ROOT_KEY, storage)) return { folder: null };
  try {
    const folder = await restoreFolderFromToken(ASSET_LIBRARY_ROOT_KEY, localFileSystem, storage);
    await validateRoot(folder);
    return { folder };
  } catch (_) {
    removeStoredValue(ASSET_LIBRARY_ROOT_KEY, storage);
    return { folder: null };
  }
}

async function changeAssetLibraryRoot({ localFileSystem, storage, promptForFolder, currentFolder = null } = {}) {
  const pick = promptForFolder || (() => localFileSystem.getFolder());
  const folder = await pick();
  if (!folder) return { folder: currentFolder, changed: false, cancelled: true };
  await validateRoot(folder);
  const previous = getStoredValue(ASSET_LIBRARY_ROOT_KEY, storage);
  if (!await saveFolderToken(ASSET_LIBRARY_ROOT_KEY, folder, localFileSystem, storage)) {
    if (previous) setStoredValue(ASSET_LIBRARY_ROOT_KEY, previous, storage);
    else removeStoredValue(ASSET_LIBRARY_ROOT_KEY, storage);
    throw new Error("Could not remember the asset library folder.");
  }
  return { folder, changed: true };
}

async function ensureCategoryFolder(root, category) {
  const catName = validateCategory(category);
  const entries = await root.getEntries();
  const existing = entries.find(entry => String(entry.name).toUpperCase() === catName);
  if (existing) {
    if (!existing.isFolder) throw new Error(`A file already uses the category name ${catName}.`);
    return existing;
  }
  return root.createFolder(catName);
}

const CATEGORY_FILE_CONFIGS = Object.freeze({
  "PNG TEXT": Object.freeze({ prefix: "mm_text", pattern: /^mm_text(\d+)\.png$/i }),
  "PNG ASSET": Object.freeze({ prefix: "mm_asset", pattern: /^mm_asset(\d+)\.png$/i }),
  "DECORATION": Object.freeze({ prefix: "mm_decoration", pattern: /^mm_decoration(\d+)\.png$/i }),
  "PNG BORDER": Object.freeze({ prefix: "mm_border", pattern: /^mm_border(\d+)\.png$/i }),
  "PNG MASK": Object.freeze({ prefix: "mm_mask", pattern: /^mm_mask(\d+)\.png$/i })
});

function getCategoryFileConfig(category) {
  const validCategory = validateCategory(category);
  const config = CATEGORY_FILE_CONFIGS[validCategory];
  if (!config) {
    throw new Error(`No file configuration for category ${validCategory}`);
  }
  return config;
}

async function reserveAssetFile(folder, category = null) {
  const cat = category || folder?.name || DEFAULT_CATEGORY;
  const config = getCategoryFileConfig(cat);
  const entries = await folder.getEntries();
  let highest = 0;
  for (const entry of entries) {
    if (entry.isFile && !entry.isFolder) {
      const match = config.pattern.exec(entry.name || "");
      if (match) {
        const number = Number(match[1]);
        if (!Number.isSafeInteger(number)) throw new Error("Asset sequence number is too large.");
        highest = Math.max(highest, number);
      }
    }
  }
  const nextNumber = highest + 1;
  if (!Number.isSafeInteger(nextNumber)) throw new Error("Asset sequence number is too large.");
  const padded = nextNumber < 100 ? String(nextNumber).padStart(2, "0") : String(nextNumber);
  const fileName = `${config.prefix}${padded}.png`;
  return folder.createFile(fileName, { overwrite: false });
}

module.exports = {
  ASSET_LIBRARY_ROOT_KEY,
  ASSET_CATEGORIES,
  DEFAULT_CATEGORY,
  CATEGORY_FILE_CONFIGS,
  getCategoryFileConfig,
  validateCategory,
  validateRoot,
  resolveAssetLibraryRoot,
  changeAssetLibraryRoot,
  ensureCategoryFolder,
  reserveAssetFile,
  getFolderDisplayPath
};
