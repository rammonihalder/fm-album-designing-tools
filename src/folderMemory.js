"use strict";

const TOKEN_KEYS = Object.freeze({
  OPEN_PSD: "mm_open_psd_last_folder_token",
  AUTO_PHOTO_FILL: "mm_auto_photo_fill_last_folder_token",
  SAVE_PAGE: "mm_save_page_last_folder_token",
  SAVE_EDITED_PHOTOS: "mm_save_edited_photos_folder_token",
  SAVE_PSD_CATEGORY: "mm_save_psd_category_base_folder_token"
});

function getStoredValue(key, storageRef = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    return storageRef ? storageRef.getItem(key) : null;
  } catch (_) {
    return null;
  }
}

function setStoredValue(key, value, storageRef = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (storageRef) {
      storageRef.setItem(key, String(value));
    }
  } catch (_) {}
}

function removeStoredValue(key, storageRef = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (storageRef) {
      storageRef.removeItem(key);
    }
  } catch (_) {}
}

async function restoreFolderFromToken(tokenKey, localFileSystem, storageRef) {
  const token = getStoredValue(tokenKey, storageRef);
  if (!token || !localFileSystem || typeof localFileSystem.getEntryForPersistentToken !== "function") {
    return null;
  }
  try {
    const entry = await localFileSystem.getEntryForPersistentToken(token);
    if (entry && (entry.isFolder || !entry.isFile)) {
      return entry;
    }
    removeStoredValue(tokenKey, storageRef);
    return null;
  } catch (_) {
    removeStoredValue(tokenKey, storageRef);
    return null;
  }
}

async function saveFolderToken(tokenKey, folderEntry, localFileSystem, storageRef) {
  if (!folderEntry || !localFileSystem || typeof localFileSystem.createPersistentToken !== "function") {
    return null;
  }
  try {
    const token = await localFileSystem.createPersistentToken(folderEntry);
    if (!token) throw new Error("Persistent token creation returned no token.");
    setStoredValue(tokenKey, token, storageRef);
    if (getStoredValue(tokenKey, storageRef) !== token) throw new Error("Persistent folder token could not be stored.");
    return token;
  } catch (err) {
    console.warn(`[FolderMemory] Could not create persistent token for ${tokenKey}:`, err);
  }
  return null;
}

// Shared by the three save tools. A picker cancellation never replaces a valid
// token; stale tokens are cleared individually, without touching other tools.
async function resolveRememberedFolder({ tokenKey, legacyTokenKey, localFileSystem, storage,
  selectFolder, browseFolder, tool, useRememberedDirectly = false }) {
  async function restore(key) {
    const entry = await restoreFolderFromToken(key, localFileSystem, storage);
    if (!entry) return null;
    try {
      if (entry.isFolder !== true) throw new Error("Remembered entry is not a folder");
      // Validate accessibility without exposing child enumeration to the
      // confirmation controller. This is what distinguishes a stale token.
      if (typeof entry.getEntries === "function") await entry.getEntries();
      return entry;
    } catch (_) {
      removeStoredValue(key, storage);
      return null;
    }
  }

  let remembered = await restore(tokenKey);
  if (!remembered && legacyTokenKey) {
    remembered = await restore(legacyTokenKey);
    if (remembered) {
      const token = getStoredValue(legacyTokenKey, storage);
      setStoredValue(tokenKey, token, storage);
      // Retain the old token if storage rejected the canonical write.
      if (getStoredValue(tokenKey, storage) === token) removeStoredValue(legacyTokenKey, storage);
    }
  }
  if (remembered) {
    if (useRememberedDirectly) return remembered;
    if (typeof browseFolder !== "function") throw new Error("Folder browser is not available.");
    const result = await browseFolder({ initialFolder: remembered, tool });
    if (!result || result.cancelled || !result.folder) return null;
    if (result.folder.isFolder !== true) throw new Error("Selected entry is not a folder.");
    if (result.changed === true || result.folder !== remembered) {
      await saveFolderToken(tokenKey, result.folder, localFileSystem, storage);
    }
    return result.folder;
  }

  const pick = typeof selectFolder === "function"
    ? selectFolder
    : localFileSystem && typeof localFileSystem.getFolder === "function"
      ? () => localFileSystem.getFolder()
      : null;
  if (!pick) throw new Error("Folder selection API is not available.");
  const selected = await pick();
  if (!selected) return null;
  if (selected.isFolder !== true) throw new Error("Selected entry is not a folder.");
  await saveFolderToken(tokenKey, selected, localFileSystem, storage);
  return selected;
}

async function getFolderDisplayPath(folderEntry, localFileSystem) {
  if (!folderEntry) return "";
  try {
    const fs = localFileSystem || (typeof require !== "undefined" ? require("uxp")?.storage?.localFileSystem : null);
    if (fs && typeof fs.getNativePath === "function") {
      const p = await fs.getNativePath(folderEntry);
      if (p) return p;
    }
  } catch (_) {}
  if (folderEntry.nativePath) return folderEntry.nativePath;
  return folderEntry.name || "";
}

async function getParentFolder(fileEntry, localFileSystem) {
  if (!fileEntry) return null;
  if (fileEntry.parent && (fileEntry.parent.isFolder || !fileEntry.parent.isFile)) {
    return fileEntry.parent;
  }
  const fs = localFileSystem || (typeof require !== "undefined" ? require("uxp")?.storage?.localFileSystem : null);
  if (!fs) return null;

  try {
    let nativePath = null;
    if (typeof fs.getNativePath === "function") {
      nativePath = await fs.getNativePath(fileEntry);
    } else if (fileEntry.nativePath) {
      nativePath = fileEntry.nativePath;
    }

    if (nativePath && typeof nativePath === "string") {
      const normalized = nativePath.replace(/\\/g, "/");
      const slash = normalized.lastIndexOf("/");
      if (slash > 0) {
        const isWindows = /^[A-Za-z]:/.test(normalized);
        const parentNative = isWindows && slash === 2
          ? nativePath.slice(0, 3)
          : nativePath.slice(0, slash);

        const rawParent = parentNative.replace(/\\/g, "/");
        const resolverInput = "file:" + (rawParent.startsWith("/") ? "" : "/") + rawParent;
        if (typeof fs.getEntryWithUrl === "function") {
          const entry = await fs.getEntryWithUrl(resolverInput);
          if (entry && (entry.isFolder || !entry.isFile)) {
            return entry;
          }
        }
      }
    }
  } catch (_) {}

  return null;
}

module.exports = {
  TOKEN_KEYS,
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  restoreFolderFromToken,
  saveFolderToken,
  resolveRememberedFolder,
  getFolderDisplayPath,
  getParentFolder
};
