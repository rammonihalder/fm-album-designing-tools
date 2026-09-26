"use strict";

const {
  TOKEN_KEYS,
  getStoredValue,
  setStoredValue,
  resolveRememberedFolder
} = require("../folderMemory");
const { readBounds, saveDocumentCopyPsd, closeDocumentWithoutSaving, findDocumentById } = require("../photoshop");

const BASE_FOLDER_TOKEN_KEY = TOKEN_KEYS.SAVE_PSD_CATEGORY;
const DEVICE_STORAGE_KEY = "mm_save_psd_category_device_name";
const DELETE_ORIGINAL_STORAGE_KEY = "mm_save_psd_category_delete_original";

const CATEGORIES = Object.freeze([
  "3 PHOTOS PSD",
  "4 PHOTOS PSD",
  "5 PHOTOS PSD",
  "6 PHOTOS PSD",
  "7 PHOTOS PSD",
  "8 PHOTOS PSD",
  "9 PHOTOS PSD",
  "10 PHOTOS PSD",
  "11 PHOTOS PSD",
  "12 PHOTOS PSD",
  "INSTA POST",
  "RICE CEREMONY"
]);

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

function cleanCategoryName(category) {
  if (typeof category !== "string") return "";
  return category.replace(/\s+PSD$/i, "").trim();
}

function sanitizeCustomName(input) {
  if (input === null || input === undefined) return "";
  const cleaned = String(input)
    .replace(INVALID_FILENAME_CHARS, "")
    .trim()
    .replace(/\s+/g, " ");
  return cleaned;
}

function normalizeDeviceName(val) {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return "CUSTOM";
  if (/^LT(\s*\(.*\))?$/i.test(trimmed)) return "LT";
  if (/^PC(\s*\(.*\))?$/i.test(trimmed)) return "PC";
  const custom = trimmed.replace(/\s+/g, "").toUpperCase();
  return custom || "CUSTOM";
}

function detectAutoCategory(selectedCount) {
  if (typeof selectedCount === "number" && selectedCount >= 3 && selectedCount <= 12) {
    const match = `${selectedCount} PHOTOS PSD`;
    if (CATEGORIES.includes(match)) {
      return match;
    }
  }
  return CATEGORIES[0];
}

function pad2(n) {
  const num = Number(n) || 0;
  return num < 10 ? `0${num}` : String(num);
}

function buildOrientationString(landscapeCount, portraitCount, squareCount) {
  const l = Math.max(0, Number(landscapeCount) || 0);
  const p = Math.max(0, Number(portraitCount) || 0);
  const s = Math.max(0, Number(squareCount) || 0);

  const parts = [];
  if (l > 0) parts.push(`${l}L`);
  if (p > 0) parts.push(`${p}P`);
  if (s > 0) parts.push(`${s}S`);

  return parts.join("_");
}

function buildSavePsdCategoryFileName({ orientationPart = "", customName = "", cleanCategory, sequenceNumber, deviceName }) {
  const parts = [];
  if (orientationPart) parts.push(orientationPart);
  if (customName) parts.push(customName);
  parts.push(`MMR ${cleanCategory} ${pad2(sequenceNumber)} ${deviceName}`);
  return parts.join("_") + ".psd";
}

function buildCategorySequenceRegex(cleanCategory) {
  const escaped = cleanCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|.*_)MMR\\s+${escaped}\\s+(\\d+)(?:\\s+.+)?\\.psd$`, "i");
}

function getNextCategorySequenceNumber(existingNames = [], cleanCategory) {
  const regex = buildCategorySequenceRegex(cleanCategory);
  let max = 0;
  for (const name of existingNames) {
    if (typeof name !== "string") continue;
    const match = name.trim().match(regex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (Number.isFinite(num) && num > max) {
        max = num;
      }
    }
  }
  return max + 1;
}

function detectLayerOrientations(layers, readBoundsFn = readBounds) {
  let landscapeCount = 0;
  let portraitCount = 0;
  let squareCount = 0;

  if (!Array.isArray(layers)) return { landscapeCount: 0, portraitCount: 0, squareCount: 0 };

  for (const layer of layers) {
    try {
      const bounds = typeof readBoundsFn === "function" ? readBoundsFn(layer) : (layer.bounds || {});
      const w = (bounds.right !== undefined ? bounds.right : 0) - (bounds.left !== undefined ? bounds.left : 0);
      const h = (bounds.bottom !== undefined ? bounds.bottom : 0) - (bounds.top !== undefined ? bounds.top : 0);
      if (w <= 0 || h <= 0) continue;
      if (h > w) {
        portraitCount++;
      } else if (w > h) {
        landscapeCount++;
      } else {
        squareCount++;
      }
    } catch (_) {}
  }

  return { landscapeCount, portraitCount, squareCount };
}

function buildSavePsdCategoryToast(result) {
  if (!result) return { message: "PSD save failed", type: "error" };

  switch (result.outcome) {
    case "no-document":
      return { message: "Open PSD first", type: "warning" };
    case "no-selected-layers":
      return { message: "Select placeholder layers!", type: "warning" };
    case "cancelled":
      return { message: "Cancelled", type: "info" };
    case "document-closed":
      return { message: "Document is no longer open", type: "error" };
    case "psd-failed":
      return { message: "PSD save failed", type: "error" };
    case "success":
      return { message: `PSD saved: ${result.fileName}`, type: "success" };
    case "saved-original-deleted":
      return { message: "Saved • original deleted", type: "success" };
    case "success-delete-cancelled":
      return { message: "Saved • delete cancelled", type: "info" };
    case "saved-delete-failed":
      return { message: "Saved, but original delete failed", type: "warning" };
    case "saved-close-failed":
      return { message: "PSD saved, but source could not be closed", type: "warning" };
    case "error":
    case "failed":
    default:
      return { message: "PSD save failed", type: "error" };
  }
}

async function getOrCreateSubfolder(parentFolder, subfolderName) {
  if (!parentFolder) throw new Error("Parent folder is required.");
  try {
    const existing = await parentFolder.getEntry(subfolderName);
    if (existing && (existing.isFolder || !existing.isFile)) {
      return existing;
    }
  } catch (_) {}

  if (typeof parentFolder.createFolder === "function") {
    return parentFolder.createFolder(subfolderName);
  }
  throw new Error(`Cannot create subfolder "${subfolderName}".`);
}

async function isFileExisting(folder, fileName) {
  try {
    const entry = await folder.getEntry(fileName);
    return Boolean(entry && entry.isFile);
  } catch (_) {
    return false;
  }
}

async function resolveCollisionFreeCandidate(categoryFolder, { orientationPart, customName, cleanCategory, sequenceNumber, deviceName }) {
  let seq = sequenceNumber;
  let attempts = 0;
  while (attempts < 1000) {
    const candidate = buildSavePsdCategoryFileName({
      orientationPart,
      customName,
      cleanCategory,
      sequenceNumber: seq,
      deviceName
    });
    const exists = await isFileExisting(categoryFolder, candidate);
    if (!exists) {
      return { fileName: candidate, sequenceNumber: seq };
    }
    seq++;
    attempts++;
  }
  throw new Error("Could not find a collision-free filename after 1000 attempts.");
}

async function executeSavePsdCategory(dependencies = {}, options = {}) {
  const {
    app,
    core,
    localFileSystem,
    storage = typeof localStorage !== "undefined" ? localStorage : null,
    getActiveDocument,
    getSelectedLayers,
    selectFolder,
    promptForDeviceName,
    promptForCategoryOptions,
    promptForOrientationCheck,
    promptForDeleteConfirmation,
    saveDocumentCopy = saveDocumentCopyPsd,
    closeDocWithoutSaving = closeDocumentWithoutSaving,
    deleteOriginalFile,
    getSourceFileEntry,
    executeModal
  } = dependencies;

  // 1. Stage: validate-document
  const documentsCount = app?.documents?.length;
  const activeDoc = documentsCount === 0 ? null : (typeof getActiveDocument === "function"
    ? getActiveDocument()
    : app?.activeDocument);

  console.log("[SAVE PSD CATEGORY] document check", {
    documentsCount: documentsCount ?? (activeDoc ? 1 : 0),
    activeDocumentId: activeDoc?.id ?? null,
    activeDocumentName: activeDoc?.name ?? null
  });

  if (!activeDoc || !activeDoc.id) {
    return { outcome: "no-document" };
  }

  const targetDocId = activeDoc.id;
  const targetDocName = activeDoc.name || "Untitled";

  // Snapshot the actual selected layers before any asynchronous work.
  const selectedLayers = Array.from(typeof getSelectedLayers === "function"
    ? getSelectedLayers(activeDoc) || []
    : activeDoc.activeLayers || []);

  // Capture original source file reference BEFORE any asynchronous prompts/pickers
  let originalSourceFile = null;
  if (typeof getSourceFileEntry === "function") {
    try {
      originalSourceFile = await getSourceFileEntry(activeDoc);
    } catch (_) {}
  } else if (activeDoc._fileEntry) {
    originalSourceFile = activeDoc._fileEntry;
  } else if (activeDoc.fileEntry) {
    originalSourceFile = activeDoc.fileEntry;
  }

  // 2. Stage: validate-selected-layers
  if (!selectedLayers || selectedLayers.length === 0) {
    return { outcome: "no-selected-layers" };
  }

  // 3. Stage: base-folder
  let baseFolder = null;
  try {
    baseFolder = await resolveRememberedFolder({
      tokenKey: BASE_FOLDER_TOKEN_KEY,
      localFileSystem,
      storage,
      selectFolder,
      browseFolder: dependencies.browseFolder || options.browseFolder,
      tool: "SAVE PSD CATEGORY",
      useRememberedDirectly: options.useRememberedDirectly === true
    });
  } catch (folderErr) {
    console.error("[Save PSD Category] Base folder selection error:", folderErr);
    return { outcome: "error", error: folderErr };
  }

  if (!baseFolder) {
    return { outcome: "cancelled" };
  }

  // 4. Stage: device-name
  let deviceName = getStoredValue(DEVICE_STORAGE_KEY, storage);
  if (!deviceName) {
    if (typeof promptForDeviceName === "function") {
      const devResult = await promptForDeviceName();
      if (!devResult || devResult.cancelled || typeof devResult.deviceName !== "string") {
        return { outcome: "cancelled" };
      }
      deviceName = normalizeDeviceName(devResult.deviceName);
      if (deviceName) {
        setStoredValue(DEVICE_STORAGE_KEY, deviceName, storage);
      } else {
        return { outcome: "cancelled" };
      }
    } else {
      deviceName = "PC";
    }
  } else {
    deviceName = normalizeDeviceName(deviceName) || "PC";
  }

  // 5. Stage: category-options-dialog
  const autoCategory = detectAutoCategory(selectedLayers.length);
  const rememberedDelete = getStoredValue(DELETE_ORIGINAL_STORAGE_KEY, storage) === "true";

  let selectedCategory = autoCategory;
  let customName = "";
  let deleteOriginal = rememberedDelete;

  if (typeof promptForCategoryOptions === "function") {
    const optsResult = await promptForCategoryOptions({
      categories: CATEGORIES,
      defaultCategory: autoCategory,
      deleteOriginal: rememberedDelete
    });
    if (!optsResult || optsResult.cancelled) {
      return { outcome: "cancelled" };
    }
    selectedCategory = optsResult.category || autoCategory;
    customName = sanitizeCustomName(optsResult.customName || "");
    deleteOriginal = Boolean(optsResult.deleteOriginal);
    setStoredValue(DELETE_ORIGINAL_STORAGE_KEY, String(deleteOriginal), storage);
  }

  // 6. Stage: orientation-detection & orientation-check-dialog
  const detected = detectLayerOrientations(selectedLayers, dependencies.readBounds);
  let finalLandscape = detected.landscapeCount;
  let finalPortrait = detected.portraitCount;
  let finalSquare = detected.squareCount;

  if (typeof promptForOrientationCheck === "function") {
    const orientResult = await promptForOrientationCheck({
      landscapeCount: detected.landscapeCount,
      portraitCount: detected.portraitCount,
      squareCount: detected.squareCount
    });
    if (!orientResult || orientResult.cancelled) {
      return { outcome: "cancelled" };
    }
    finalLandscape = Math.max(0, parseInt(orientResult.landscapeCount, 10) || 0);
    finalPortrait = Math.max(0, parseInt(orientResult.portraitCount, 10) || 0);
    finalSquare = Math.max(0, parseInt(orientResult.squareCount, 10) || 0);
  }

  const orientationPart = buildOrientationString(finalLandscape, finalPortrait, finalSquare);
  const cleanCategory = cleanCategoryName(selectedCategory);

  // 7. Stage: category-subfolder & numbering
  let categoryFolder = null;
  try {
    categoryFolder = await getOrCreateSubfolder(baseFolder, selectedCategory);
  } catch (subErr) {
    console.error("[Save PSD Category] Category subfolder creation error:", subErr);
    return { outcome: "error", error: subErr };
  }

  let existingNames = [];
  try {
    if (typeof categoryFolder.getEntries === "function") {
      const entries = await categoryFolder.getEntries();
      existingNames = entries.map(e => e.name);
    }
  } catch (_) {}

  const nextSeq = getNextCategorySequenceNumber(existingNames, cleanCategory);

  let targetCandidate = null;
  try {
    targetCandidate = await resolveCollisionFreeCandidate(categoryFolder, {
      orientationPart,
      customName,
      cleanCategory,
      sequenceNumber: nextSeq,
      deviceName
    });
  } catch (candErr) {
    console.error("[Save PSD Category] Collision resolution error:", candErr);
    return { outcome: "error", error: candErr };
  }

  const fileName = targetCandidate.fileName;

  // 8. Stage: save-psd-copy
  let targetFileEntry = null;
  try {
    if (typeof categoryFolder.createFile === "function") {
      targetFileEntry = await categoryFolder.createFile(fileName, { overwrite: false });
    }
  } catch (fileCreateErr) {
    console.error("[Save PSD Category] Target file creation error:", fileCreateErr);
    return { outcome: "psd-failed", error: fileCreateErr };
  }

  const docFinder = dependencies.findDocumentById || findDocumentById;
  let currentDoc = null;
  if (app && app.documents) {
    currentDoc = docFinder(targetDocId, app);
  } else if (typeof getActiveDocument === "function") {
    currentDoc = getActiveDocument();
  } else {
    currentDoc = activeDoc;
  }
  if (!currentDoc || currentDoc.id !== targetDocId) {
    return { outcome: "document-closed" };
  }

  const runModal = typeof executeModal === "function"
    ? executeModal
    : async (fn, name) => {
        if (core && typeof core.executeAsModal === "function") {
          return core.executeAsModal(async executionContext => fn(executionContext), {
            commandName: name || "MM Save PSD Category"
          });
        }
        return fn({});
      };

  try {
    await runModal(async () => {
      if (app?.documents) {
        currentDoc = docFinder(targetDocId, app);
        if (!currentDoc) throw new Error("Source document is no longer open");
      }
      await saveDocumentCopy(currentDoc, targetFileEntry, { embedColorProfile: true, layers: true });
    }, "MM Save PSD Category");
  } catch (saveErr) {
    console.error("[Save PSD Category] PSD copy save error:", saveErr);
    return { outcome: "psd-failed", error: saveErr };
  }

  // 9. Stage: original-delete-handling
  async function closeSource() {
    await runModal(async () => {
      const source = app?.documents ? docFinder(targetDocId, app) : currentDoc;
      if (!source) return;
      await closeDocWithoutSaving(source);
      if (app?.documents && docFinder(targetDocId, app)) {
        throw new Error("Source document did not close");
      }
    }, "MM Close Category Source");
  }
  if (!deleteOriginal) {
    try {
      await closeSource();
    } catch (error) {
      return { outcome: "saved-close-failed", fileName, error, originalDeleted: false };
    }
    return { outcome: "success", fileName, originalDeleted: false };
  }

  // deleteOriginal is checked -> show destructive confirmation
  let confirmedDelete = false;
  if (typeof promptForDeleteConfirmation === "function") {
    const confirmRes = await promptForDeleteConfirmation({ fileName, docName: targetDocName });
    if (confirmRes && confirmRes.confirmed) {
      confirmedDelete = true;
    }
  }

  if (!confirmedDelete) {
    try {
      await closeSource();
    } catch (error) {
      return { outcome: "saved-close-failed", fileName, error, originalDeleted: false };
    }
    return { outcome: "success-delete-cancelled", fileName, originalDeleted: false };
  }

  // DELETION SAFETY CHECKS:
  // 1. Is source file entry real and on disk?
  // 2. Is source file NOT the target category PSD file?
  // 3. Has doc been saved previously?
  let isSafeToDelete = false;
  if (originalSourceFile && (originalSourceFile.isFile || originalSourceFile.name)) {
    if (originalSourceFile === targetFileEntry) {
      isSafeToDelete = false;
    } else {
      const srcName = originalSourceFile.name;
      const tgtName = targetFileEntry.name;
      const srcPath = originalSourceFile.nativePath || originalSourceFile.path;
      const tgtPath = targetFileEntry.nativePath || targetFileEntry.path;

      if (srcPath && tgtPath) {
        const normalizePath = value => value.replace(/\\/g, "/").toLowerCase();
        isSafeToDelete = normalizePath(srcPath) !== normalizePath(tgtPath);
      } else if (srcName && tgtName && srcName.toLowerCase() === tgtName.toLowerCase()) {
        isSafeToDelete = false;
      } else {
        isSafeToDelete = true;
      }
    }
  }

  if (!isSafeToDelete) {
    try {
      await closeSource();
    } catch (error) {
      return { outcome: "saved-close-failed", fileName, error, originalDeleted: false };
    }
    return { outcome: "saved-delete-failed", fileName, reason: "unsafe-source" };
  }

  try {
    await closeSource();
    if (typeof deleteOriginalFile === "function") {
      await deleteOriginalFile(originalSourceFile);
    } else if (typeof originalSourceFile.delete === "function") {
      await originalSourceFile.delete();
    } else {
      throw new Error("Original file deletion API is not available");
    }
    return { outcome: "saved-original-deleted", fileName, originalDeleted: true };
  } catch (deleteErr) {
    console.warn("[Save PSD Category] Original file deletion failed:", deleteErr);
    return { outcome: "saved-delete-failed", fileName, error: deleteErr };
  }
}

async function runSavePsdCategory(options = {}) {
  const { app, core } = require("photoshop");
  const { storage } = require("uxp");
  const localFileSystem = storage.localFileSystem;
  return executeSavePsdCategory({
    app,
    core,
    localFileSystem,
    storage: typeof localStorage !== "undefined" ? localStorage : null,
    getSourceFileEntry: async doc => {
      const sourcePath = doc.path;
      // Unsaved/cloud documents have no local original to delete.
      if (typeof sourcePath !== "string" || !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(sourcePath)) return null;
      const normalized = sourcePath.replace(/\\/g, "/");
      const entry = await localFileSystem.getEntryWithUrl("file:" + (normalized.startsWith("/") ? "" : "/") + normalized);
      return entry?.isFile ? entry : null;
    },
    ...options
  }, options);
}

module.exports = {
  CATEGORIES,
  BASE_FOLDER_TOKEN_KEY,
  DEVICE_STORAGE_KEY,
  DELETE_ORIGINAL_STORAGE_KEY,
  cleanCategoryName,
  sanitizeCustomName,
  normalizeDeviceName,
  detectAutoCategory,
  pad2,
  buildOrientationString,
  buildSavePsdCategoryFileName,
  buildCategorySequenceRegex,
  getNextCategorySequenceNumber,
  detectLayerOrientations,
  buildSavePsdCategoryToast,
  getOrCreateSubfolder,
  resolveCollisionFreeCandidate,
  executeSavePsdCategory,
  runSavePsdCategory
};
