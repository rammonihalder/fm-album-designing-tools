"use strict";

const {
  TOKEN_KEYS,
  resolveRememberedFolder
} = require("../folderMemory");

const BASE_FOLDER_TOKEN_KEY = TOKEN_KEYS.SAVE_PAGE;
const PREFIX_STORAGE_KEY = "mmrlt_prefix";
const OUTPUT_MODE_STORAGE_KEY = "mm_save_page_output_mode";
const OUTPUT_MODES = Object.freeze(["psd", "jpeg", "both"]);
const SERIAL_REGEX = /MMRLT(\d+)\.(psd|jpg|jpeg)$/i;
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]/;

function sanitizePrefix(input) {
  if (input === null || input === undefined) return "";
  const trimmed = String(input).trim();
  if (!trimmed) return "";
  return trimmed.replace(/\s+/g, "_");
}

function isValidPrefix(input) {
  if (input === null || input === undefined) return true;
  const str = String(input);
  if (INVALID_FILENAME_CHARS.test(str)) {
    return false;
  }
  if (/[\x00-\x1f]/.test(str)) {
    return false;
  }
  return true;
}

function extractAlbumSerial(filename) {
  if (typeof filename !== "string") return null;
  const match = filename.match(SERIAL_REGEX);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
}

function getNextPageNumber(psdNames = [], jpegNames = []) {
  let max = 0;
  const allNames = [...(psdNames || []), ...(jpegNames || [])];
  for (const name of allNames) {
    const serial = extractAlbumSerial(name);
    if (serial !== null && serial > max) {
      max = serial;
    }
  }
  return max + 1;
}

function buildPageBaseName(prefix, number) {
  const sanitized = sanitizePrefix(prefix);
  const num = Number(number) || 1;
  if (sanitized) {
    return `${sanitized}_MMRLT${num}`;
  }
  return `MMRLT${num}`;
}

function normalizeOutputMode(mode) {
  return OUTPUT_MODES.includes(mode) ? mode : "both";
}

function buildSavePageToast(result) {
  if (!result) return { message: "Save Page failed", type: "error" };

  switch (result.outcome) {
    case "no-document":
      return { message: "Open a PSD first", type: "warning" };
    case "cancelled":
      return { message: "Cancelled", type: "info" };
    case "invalid-prefix":
      return { message: "Invalid prefix", type: "error" };
    case "document-closed":
      return { message: "Document is no longer open", type: "error" };
    case "psd-failed":
      return { message: "PSD save failed", type: "error" };
    case "jpeg-failed":
      return { message: result.outputMode === "jpeg" ? "JPEG save failed" : "PSD saved • JPEG failed", type: "warning" };
    case "success":
      if (!result.outputMode) return { message: `Saved: ${result.fileName || result.baseName}`, type: "success" };
      return { message: result.outputMode === "psd" ? "PSD page saved" : result.outputMode === "jpeg" ? "JPEG page saved" : "Page saved", type: "success" };
    case "error":
    default:
      return { message: "Save Page failed", type: "error" };
  }
}

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
      storageRef.setItem(key, value);
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

function isMissingEntry(error) {
  if (!error) return true;
  const code = error.code || error.name;
  if (code === "ENOENT" || code === "EntryNotFound" || code === "NotFoundError") return true;
  const msg = String(error.message || error || "");
  return /not found|could not find|no such file|entry not found|does not exist/i.test(msg);
}

async function getOrCreateSubfolder(parentFolder, folderName) {
  let entry = null;
  try {
    entry = await parentFolder.getEntry(folderName);
  } catch (error) {
    if (!isMissingEntry(error)) {
      throw error;
    }
  }

  if (entry) {
    if (entry.isFolder || !entry.isFile) {
      return entry;
    }
    throw new Error(`An item named "${folderName}" already exists and is not a folder.`);
  }

  return parentFolder.createFolder(folderName);
}

async function getOrCreateSubfolderIfNeeded(parentFolder, folderName, needed) {
  if (needed) return getOrCreateSubfolder(parentFolder, folderName);
  try {
    const existing = await parentFolder.getEntry(folderName);
    return existing && (existing.isFolder || !existing.isFile) ? existing : null;
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
}

async function getFolderFileNames(folder) {
  if (!folder || typeof folder.getEntries !== "function") return [];
  try {
    const entries = await folder.getEntries();
    if (!Array.isArray(entries)) return [];
    return entries
      .filter(e => e && (e.isFile || !e.isFolder))
      .map(e => e.name)
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function entryExists(folder, name) {
  if (!folder || typeof folder.getEntry !== "function") return false;
  try {
    const entry = await folder.getEntry(name);
    return Boolean(entry);
  } catch (e) {
    return false;
  }
}

async function resolveSafeFileEntries(psdFolder, jpegFolder, prefix, mode = "both", maxAttempts = 1000) {
  if (typeof mode === "number") { maxAttempts = mode; mode = "both"; }
  mode = normalizeOutputMode(mode);
  const needPsd = mode === "psd" || mode === "both";
  const needJpeg = mode === "jpeg" || mode === "both";
  let psdNames = await getFolderFileNames(psdFolder);
  let jpegNames = await getFolderFileNames(jpegFolder);
  let serial = getNextPageNumber(psdNames, jpegNames);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const baseName = buildPageBaseName(prefix, serial);
    const psdFileName = `${baseName}.psd`;
    const jpegFileName = `${baseName}.jpg`;

    const psdExists = await entryExists(psdFolder, psdFileName);
    const jpegExists = await entryExists(jpegFolder, jpegFileName);

    if ((needPsd && psdExists) || (needJpeg && jpegExists)) {
      serial++;
      continue;
    }

    try {
      const psdEntry = needPsd ? await psdFolder.createFile(psdFileName, { overwrite: false }) : null;
      let jpegEntry = null;
      if (needJpeg) {
        try {
          jpegEntry = await jpegFolder.createFile(jpegFileName, { overwrite: false });
        } catch (jpegCreateError) {
          try { if (psdEntry?.delete) await psdEntry.delete(); } catch (_) {}
          throw jpegCreateError;
        }
      }

      return {
        baseName,
        psdFileName,
        jpegFileName,
        psdEntry,
        jpegEntry,
        serial
      };
    } catch (createError) {
      // Collision or concurrency: advance serial and retry
      serial++;
      psdNames = await getFolderFileNames(psdFolder);
      jpegNames = await getFolderFileNames(jpegFolder);
      const rescanSerial = getNextPageNumber(psdNames, jpegNames);
      if (rescanSerial > serial) {
        serial = rescanSerial;
      }
    }
  }

  throw new Error("Could not find a collision-free filename after maximum attempts.");
}

function logDiagnostic(metadata) {
  console.error("[SAVE PAGE]", {
    stage: metadata.stage,
    documentId: metadata.documentId,
    documentName: metadata.documentName,
    baseFolderName: metadata.baseFolderName,
    prefix: metadata.prefix,
    serial: metadata.serial,
    fileName: metadata.fileName,
    errorName: metadata.error?.name || (metadata.error && metadata.error.constructor && metadata.error.constructor.name) || "Error",
    errorMessage: metadata.error?.message || metadata.error?.description || String(metadata.error || ""),
    stack: metadata.error?.stack
  });
}

class DocumentClosedError extends Error {
  constructor(message = "Document is no longer open") {
    super(message);
    this.name = "DocumentClosedError";
  }
}

async function executeSavePage(dependencies = {}, options = {}) {
  const {
    app,
    core,
    localFileSystem,
    storage = typeof localStorage !== "undefined" ? localStorage : null,
    selectFolder,
    promptForPrefix,
    saveDocumentCopyPsd,
    saveDocumentCopyJpeg,
    findDocumentById,
    executeModal
  } = dependencies;

  const onProgress = options.onProgress;

  // 1. Stage: validate-document
  const activeDoc = dependencies.getActiveDocument
    ? dependencies.getActiveDocument()
    : app?.activeDocument;

  if (!activeDoc || !activeDoc.id) {
    return { outcome: "no-document" };
  }

  const targetDocumentId = activeDoc.id;
  const targetDocumentName = activeDoc.name || "document";

  // 2. Stage: select-folder
  let baseFolder = null;
  try {
    baseFolder = await resolveRememberedFolder({
      tokenKey: BASE_FOLDER_TOKEN_KEY,
      legacyTokenKey: "mm_save_page_base_folder_token",
      localFileSystem,
      storage,
      selectFolder,
      browseFolder: dependencies.browseFolder || options.browseFolder,
      tool: "SAVE PAGE",
      useRememberedDirectly: options.useRememberedDirectly === true
    });
  } catch (folderError) {
    logDiagnostic({
      stage: "select-folder",
      documentId: targetDocumentId,
      documentName: targetDocumentName,
      error: folderError
    });
    return { outcome: "error", error: folderError };
  }

  if (!baseFolder) {
    return { outcome: "cancelled" };
  }

  const baseFolderName = baseFolder.name || "folder";

  // 3. Stage: prepare-folders
  let psdFolder = null;
  let jpegFolder = null;
  // 3. Stage: prefix and output format
  const rememberedPrefix = getStoredValue(PREFIX_STORAGE_KEY, storage) || "";
  const rememberedOutputMode = normalizeOutputMode(getStoredValue(OUTPUT_MODE_STORAGE_KEY, storage) || "both");
  let userPrefix = "";
  let outputMode = rememberedOutputMode;

  if (typeof promptForPrefix === "function") {
    let prefixResponse = null;
    try {
      prefixResponse = await promptForPrefix({ defaultPrefix: rememberedPrefix });
    } catch (promptError) {
      logDiagnostic({
        stage: "prefix",
        documentId: targetDocumentId,
        documentName: targetDocumentName,
        baseFolderName,
        error: promptError
      });
      return { outcome: "error", error: promptError };
    }

    if (!prefixResponse || prefixResponse.cancelled) {
      return { outcome: "cancelled" };
    }

    if (!isValidPrefix(prefixResponse.prefix)) {
      return { outcome: "invalid-prefix", error: new Error("Invalid prefix") };
    }

    userPrefix = sanitizePrefix(prefixResponse.prefix);
    outputMode = normalizeOutputMode(prefixResponse.outputMode || rememberedOutputMode);
    setStoredValue(PREFIX_STORAGE_KEY, userPrefix, storage);
    // Format preference is updated only after the user confirms SAVE.
    setStoredValue(OUTPUT_MODE_STORAGE_KEY, outputMode, storage);
  } else {
    userPrefix = rememberedPrefix;
  }

  // 4. Stage: inspect both namespaces and create only requested folders
  try {
    psdFolder = await getOrCreateSubfolderIfNeeded(baseFolder, "PSD", outputMode === "psd" || outputMode === "both");
    jpegFolder = await getOrCreateSubfolderIfNeeded(baseFolder, "JPEG", outputMode === "jpeg" || outputMode === "both");
  } catch (subfolderError) {
    logDiagnostic({ stage: "prepare-folders", documentId: targetDocumentId,
      documentName: targetDocumentName, baseFolderName, error: subfolderError });
    return { outcome: "error", error: subfolderError };
  }

  // 5. Stage: scan-number & collision-check
  let safeFiles = null;
  try {
    safeFiles = await resolveSafeFileEntries(psdFolder, jpegFolder, userPrefix, outputMode);
  } catch (scanError) {
    logDiagnostic({
      stage: "collision-check",
      documentId: targetDocumentId,
      documentName: targetDocumentName,
      baseFolderName,
      prefix: userPrefix,
      error: scanError
    });
    return { outcome: "error", error: scanError };
  }

  const { baseName, psdEntry, jpegEntry, serial } = safeFiles;

  // 6. Stage: resolve-document & save operations inside modal scope
  let psdSaved = false;
  let saveOutcome = null;

  try {
    const runModal = typeof executeModal === "function"
      ? executeModal
      : async (fn, cmd) => {
          if (core && typeof core.executeAsModal === "function") {
            return core.executeAsModal(async executionContext => fn(executionContext), {
              commandName: cmd || "MM Save Page"
            });
          }
          return fn();
        };

    saveOutcome = await runModal(async () => {
      // Re-resolve original document by ID
      const targetDoc = typeof findDocumentById === "function"
        ? findDocumentById(targetDocumentId, app)
        : (app?.documents ? Array.from(app.documents).find(d => d.id === targetDocumentId) : null);

      if (!targetDoc) {
        throw new DocumentClosedError();
      }

      // Ensure intended document is active inside modal scope if needed
      if (app && app.activeDocument && app.activeDocument.id !== targetDoc.id) {
        try {
          app.activeDocument = targetDoc;
        } catch (_) {}
      }

      // Save PSD Copy when requested.
      if (outputMode === "psd" || outputMode === "both") try {
        if (typeof saveDocumentCopyPsd === "function") {
          await saveDocumentCopyPsd(targetDoc, psdEntry, {
            embedColorProfile: true,
            alphaChannels: true
          });
        } else if (targetDoc.saveAs && typeof targetDoc.saveAs.psd === "function") {
          await targetDoc.saveAs.psd(psdEntry, {
            embedColorProfile: true,
            alphaChannels: true
          }, true);
        } else {
          throw new Error("Photoshop saveAs.psd is not available.");
        }
        psdSaved = true;
      } catch (psdError) {
        logDiagnostic({
          stage: "save-psd",
          documentId: targetDocumentId,
          documentName: targetDocumentName,
          baseFolderName,
          prefix: userPrefix,
          serial,
          fileName: baseName,
          error: psdError
        });
        return { outcome: "psd-failed", outputMode, error: psdError };
      }

      // Save JPEG Copy (Quality 12) when requested.
      if (outputMode === "jpeg" || outputMode === "both") try {
        if (typeof saveDocumentCopyJpeg === "function") {
          await saveDocumentCopyJpeg(targetDoc, jpegEntry, { quality: 12 });
        } else if (targetDoc.saveAs && typeof targetDoc.saveAs.jpg === "function") {
          await targetDoc.saveAs.jpg(jpegEntry, { quality: 12 }, true);
        } else {
          throw new Error("Photoshop saveAs.jpg is not available.");
        }
      } catch (jpegError) {
        logDiagnostic({
          stage: "save-jpeg",
          documentId: targetDocumentId,
          documentName: targetDocumentName,
          baseFolderName,
          prefix: userPrefix,
          serial,
          fileName: baseName,
          error: jpegError
        });
        return {
          outcome: "jpeg-failed",
          fileName: baseName,
          baseName,
          serial,
          psdEntry,
          outputMode,
          error: jpegError
        };
      }

      return {
        outcome: "success",
        fileName: baseName,
        baseName,
        serial,
        psdEntry,
        jpegEntry,
        outputMode
      };
    }, "MM Save Page");
  } catch (modalError) {
    if (modalError instanceof DocumentClosedError || modalError?.name === "DocumentClosedError") {
      logDiagnostic({
        stage: "resolve-document",
        documentId: targetDocumentId,
        documentName: targetDocumentName,
        baseFolderName,
        prefix: userPrefix,
        serial,
        fileName: baseName,
        error: modalError
      });
      return { outcome: "document-closed", error: modalError };
    }

    logDiagnostic({
      stage: psdSaved ? "save-jpeg" : "save-psd",
      documentId: targetDocumentId,
      documentName: targetDocumentName,
      baseFolderName,
      prefix: userPrefix,
      serial,
      fileName: baseName,
      error: modalError
    });

    if (psdSaved) {
      return {
        outcome: "jpeg-failed",
        fileName: baseName,
        baseName,
        serial,
        psdEntry,
        outputMode,
        error: modalError
      };
    }

    return { outcome: "psd-failed", outputMode, error: modalError };
  }

  return saveOutcome || { outcome: "error" };
}

function getDefaultDependencies() {
  let fs = null;
  let app = null;
  let core = null;
  let psHelpers = null;

  try {
    const { storage } = require("uxp");
    fs = storage?.localFileSystem;
  } catch (_) {}

  try {
    const photoshop = require("photoshop");
    app = photoshop?.app;
    core = photoshop?.core;
  } catch (_) {}

  try {
    psHelpers = require("../photoshop");
  } catch (_) {}

  return {
    app,
    core,
    localFileSystem: fs,
    storage: typeof localStorage !== "undefined" ? localStorage : null,
    saveDocumentCopyPsd: psHelpers?.saveDocumentCopyPsd,
    saveDocumentCopyJpeg: psHelpers?.saveDocumentCopyJpeg,
    findDocumentById: psHelpers?.findDocumentById,
    executeModal: psHelpers?.executeSavePageModal || (core?.executeAsModal
      ? (fn, cmd) => core.executeAsModal(async ctx => fn(ctx), { commandName: cmd || "MM Save Page" })
      : async fn => fn())
  };
}

async function runSavePage(options = {}) {
  const defaultDeps = getDefaultDependencies();
  const mergedDeps = {
    ...defaultDeps,
    promptForPrefix: options.promptForPrefix
  };
  return executeSavePage(mergedDeps, options);
}

module.exports = {
  BASE_FOLDER_TOKEN_KEY,
  PREFIX_STORAGE_KEY,
  OUTPUT_MODE_STORAGE_KEY,
  OUTPUT_MODES,
  SERIAL_REGEX,
  INVALID_FILENAME_CHARS,
  sanitizePrefix,
  isValidPrefix,
  extractAlbumSerial,
  getNextPageNumber,
  buildPageBaseName,
  normalizeOutputMode,
  buildSavePageToast,
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  isMissingEntry,
  getOrCreateSubfolder,
  getOrCreateSubfolderIfNeeded,
  getFolderFileNames,
  entryExists,
  resolveSafeFileEntries,
  executeSavePage,
  runSavePage,
  getDefaultDependencies,
  DocumentClosedError
};
