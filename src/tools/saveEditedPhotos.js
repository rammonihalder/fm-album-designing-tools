"use strict";

const { flattenLayers, getSelectedLayersTopToBottom } = require("../layers");
const {
  selectLayerById,
  selectLayersByIds,
  openSmartObjectContents,
  closeDocumentWithoutSaving,
  saveDocumentCopyJpeg,
  findDocumentById,
  executeSaveEditedPhotosModal
} = require("../photoshop");

const {
  TOKEN_KEYS,
  resolveRememberedFolder
} = require("../folderMemory");

const FOLDER_TOKEN_KEY = TOKEN_KEYS.SAVE_EDITED_PHOTOS;
const DEVICE_STORAGE_KEY = "mm_edited_photos_device_type";
const FILENAME_REGEX = /^FM(\d+) (LT|DT)\.jpe?g$/i;

function normalizeDeviceType(value) {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if (upper === "LT" || upper === "DT") {
    return upper;
  }
  return null;
}

function isValidDeviceType(value) {
  return normalizeDeviceType(value) !== null;
}

function getStoredDeviceType(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const val = getStoredValue(DEVICE_STORAGE_KEY, storage);
  return normalizeDeviceType(val);
}

function saveDeviceType(storage = typeof localStorage !== "undefined" ? localStorage : null, type) {
  const normalized = normalizeDeviceType(type);
  if (normalized) {
    setStoredValue(DEVICE_STORAGE_KEY, normalized, storage);
    return normalized;
  }
  return null;
}

function extractEditedPhotoNumber(filename) {
  if (typeof filename !== "string") return null;
  const match = filename.trim().match(FILENAME_REGEX);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function findNextEditedPhotoNumber(existingNames) {
  if (!Array.isArray(existingNames) || existingNames.length === 0) {
    return 1;
  }

  const occupiedNumbers = new Set();
  for (const name of existingNames) {
    const num = extractEditedPhotoNumber(name);
    if (num !== null && num > 0) {
      occupiedNumbers.add(num);
    }
  }

  let candidate = 1;
  while (occupiedNumbers.has(candidate)) {
    candidate++;
  }
  return candidate;
}

function buildEditedPhotoFileName(number, deviceType = "LT") {
  const normalized = normalizeDeviceType(deviceType);
  if (!normalized) {
    throw new Error(`Invalid device type "${deviceType}". Only "LT" or "DT" are allowed.`);
  }
  return `FM${number} ${normalized}.jpg`;
}

function isSmartObjectLayer(layer) {
  if (!layer) return false;
  if (layer.isBackgroundLayer) return false;
  if (layer.layers && layer.layers.length > 0) return false;
  if (layer.typename === "LayerSet") return false;

  const kind = layer.kind;
  const kindStr = String(kind || "").toLowerCase();

  if (
    kindStr === "text" ||
    kindStr === "adjustment" ||
    kindStr === "normal" ||
    kindStr === "solidcolor" ||
    kindStr === "vector" ||
    kindStr === "background"
  ) {
    return false;
  }

  if (kindStr === "smartobject" || kind === 5) {
    return true;
  }

  try {
    const photoshop = require("photoshop");
    const smartObjectEnum = photoshop?.constants?.LayerKind?.SMARTOBJECT;
    if (
      smartObjectEnum !== undefined &&
      (kind === smartObjectEnum || String(smartObjectEnum).toLowerCase() === kindStr)
    ) {
      return true;
    }
  } catch {
    // Non-photoshop runtime fallback
  }

  if (layer.smartObject && typeof layer.smartObject === "object") {
    return true;
  }

  return false;
}

function buildSaveEditedPhotosToast(result) {
  if (!result) return { message: "Edited photo export failed", type: "error" };

  switch (result.outcome) {
    case "no-document":
      return { message: "Open a document first", type: "warning" };
    case "no-smart-objects":
      return { message: "Select Smart Object layers", type: "warning" };
    case "cancelled":
      return { message: "Cancelled", type: "info" };
    case "document-closed":
      return { message: "Document is no longer open", type: "error" };
    case "success":
      if (result.successCount === 1 && (!result.failedCount || result.failedCount === 0)) {
        return { message: "1 edited photo saved", type: "success" };
      }
      if (result.successCount > 1 && (!result.failedCount || result.failedCount === 0)) {
        return { message: `${result.successCount} edited photos saved`, type: "success" };
      }
      if (result.successCount > 0 && result.failedCount > 0) {
        return { message: `${result.successCount} saved • ${result.failedCount} failed`, type: "warning" };
      }
      return { message: "Edited photo export failed", type: "error" };
    case "failed":
    case "error":
    default:
      return { message: "Edited photo export failed", type: "error" };
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

function logDiagnostic(metadata) {
  console.error("[SAVE EDITED PHOTOS]", {
    stage: metadata.stage,
    mainDocumentId: metadata.mainDocumentId,
    mainDocumentName: metadata.mainDocumentName,
    layerId: metadata.layerId,
    layerName: metadata.layerName,
    exportNumber: metadata.exportNumber,
    fileName: metadata.fileName,
    smartObjectDocumentId: metadata.smartObjectDocumentId,
    smartObjectDocumentName: metadata.smartObjectDocumentName,
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

async function executeSaveEditedPhotos(dependencies = {}, options = {}) {
  const {
    app,
    core,
    localFileSystem,
    storage = typeof localStorage !== "undefined" ? localStorage : null,
    getActiveDocument,
    getSelectedLayers,
    getAllLayers,
    selectFolder,
    promptForDeviceType,
    getDeviceType = getStoredDeviceType,
    saveDevice = saveDeviceType,
    findDocById = findDocumentById,
    selectLayer = selectLayerById,
    selectLayers = selectLayersByIds,
    openSmartObject = openSmartObjectContents,
    closeSmartObject = closeDocumentWithoutSaving,
    saveJpeg = saveDocumentCopyJpeg,
    executeModal
  } = dependencies;

  const runModal = typeof executeModal === "function"
    ? executeModal
    : async (fn, cmd) => {
        if (core && typeof core.executeAsModal === "function") {
          return core.executeAsModal(async executionContext => fn(executionContext), {
            commandName: cmd || "FM Save Edited Photos"
          });
        }
        return fn();
      };

  // 1. Stage: validate-document
  const activeDoc = typeof getActiveDocument === "function"
    ? getActiveDocument()
    : app?.activeDocument;

  if (!activeDoc || !activeDoc.id) {
    return { outcome: "no-document" };
  }

  const mainDocumentId = activeDoc.id;
  const mainDocumentName = activeDoc.name || "document";

  // 2. Stage: capture-selection
  let selectedLayers = [];
  if (typeof getSelectedLayers === "function") {
    selectedLayers = getSelectedLayers(activeDoc);
  } else if (activeDoc.activeLayers) {
    try {
      selectedLayers = getSelectedLayersTopToBottom();
    } catch (_) {
      selectedLayers = Array.from(activeDoc.activeLayers || []);
    }
  }

  const originalSelectedLayerIds = selectedLayers.map(l => l.id);

  // 3. Stage: filter smart objects
  const smartObjectLayers = selectedLayers.filter(isSmartObjectLayer);
  if (!smartObjectLayers.length) {
    return {
      outcome: "no-smart-objects",
      mainDocumentId,
      mainDocumentName,
      originalSelectedLayerIds
    };
  }

  // 4. Stage: check-device-type
  let activeDeviceType = typeof getDeviceType === "function"
    ? getDeviceType(storage)
    : getStoredDeviceType(storage);

  if (!isValidDeviceType(activeDeviceType)) {
    const promptFn = promptForDeviceType || options.promptForDeviceType;
    if (typeof promptFn === "function") {
      const promptResult = await promptFn();
      if (!promptResult || promptResult.cancelled || !isValidDeviceType(promptResult.deviceType)) {
        return { outcome: "cancelled" };
      }
      activeDeviceType = normalizeDeviceType(promptResult.deviceType);
      if (typeof saveDevice === "function") {
        saveDevice(storage, activeDeviceType);
      } else {
        saveDeviceType(storage, activeDeviceType);
      }
    } else {
      activeDeviceType = "LT";
    }
  }

  // 5. Stage: select-folder
  let destFolder = null;
  try {
    destFolder = await resolveRememberedFolder({
      tokenKey: FOLDER_TOKEN_KEY,
      localFileSystem,
      storage,
      selectFolder,
      browseFolder: dependencies.browseFolder || options.browseFolder,
      tool: "SAVE EDITED PHOTOS",
      useRememberedDirectly: options.useRememberedDirectly === true
    });
  } catch (folderError) {
    logDiagnostic({
      stage: "select-folder",
      mainDocumentId,
      mainDocumentName,
      error: folderError
    });
    return { outcome: "error", error: folderError };
  }

  if (!destFolder) {
    return { outcome: "cancelled" };
  }

  // 6. Stage: scan-number & per-layer sequential processing
  let successCount = 0;
  let failedCount = 0;
  let firstFailureError = null;
  const exportedFiles = [];
  const assignedNumbers = new Set();

  let initialNames = [];
  try {
    if (typeof destFolder.getEntries === "function") {
      const entries = await destFolder.getEntries();
      initialNames = entries.map(e => e.name);
    }
  } catch (_) {
    initialNames = [];
  }

  const allOccupiedNumbers = new Set();
  for (const n of initialNames) {
    const num = extractEditedPhotoNumber(n);
    if (num !== null) allOccupiedNumbers.add(num);
  }

  try {
    for (let i = 0; i < smartObjectLayers.length; i++) {
      const targetLayerInfo = smartObjectLayers[i];
      const layerId = targetLayerInfo.id;
      const layerName = targetLayerInfo.name || `Layer ${layerId}`;

      let currentExportNumber = null;
      let currentFileName = null;
      let smartDocOpened = null;

      try {
        await runModal(async () => {
          // Re-resolve main document by ID
          const currentMainDoc = typeof findDocById === "function"
            ? findDocById(mainDocumentId, app)
            : (app?.documents ? Array.from(app.documents).find(d => d.id === mainDocumentId) : null);

          if (!currentMainDoc) {
            throw new DocumentClosedError();
          }

          // Reactivate main document
          if (app && app.activeDocument !== currentMainDoc) {
            app.activeDocument = currentMainDoc;
          }

          // Resolve target layer by ID
          const allDocLayers = typeof getAllLayers === "function"
            ? getAllLayers(currentMainDoc)
            : (currentMainDoc.layers ? flattenLayers(currentMainDoc.layers, []) : []);

          const layerToProcess = allDocLayers.find(l => l.id === layerId);
          if (!layerToProcess) {
            throw new Error(`Target layer "${layerName}" (id: ${layerId}) was deleted or could not be found.`);
          }

          // Activate layer
          if (typeof selectLayer === "function") {
            await selectLayer(layerId);
          }

          // Snapshot open document IDs
          const docIdsBefore = new Set((app?.documents ? Array.from(app.documents) : []).map(d => d.id));

          // Open Smart Object contents
          if (typeof openSmartObject === "function") {
            await openSmartObject(layerToProcess);
          }

          // Identify newly opened Smart Object document
          const docListAfter = app?.documents ? Array.from(app.documents) : [];
          smartDocOpened = docListAfter.find(d => !docIdsBefore.has(d.id) && d.id !== mainDocumentId);
          if (!smartDocOpened && app?.activeDocument && app.activeDocument.id !== mainDocumentId) {
            smartDocOpened = app.activeDocument;
          }

          if (!smartDocOpened) {
            const checkMain = typeof findDocById === "function"
              ? findDocById(mainDocumentId, app)
              : (app?.documents ? Array.from(app.documents).find(d => d.id === mainDocumentId) : null);
            if (!checkMain) {
              throw new DocumentClosedError();
            }
            throw new Error(`Could not identify opened Smart Object document for layer "${layerName}".`);
          }

          // Find first free positive integer
          let nextNum = 1;
          while (allOccupiedNumbers.has(nextNum) || assignedNumbers.has(nextNum)) {
            nextNum++;
          }
          currentExportNumber = nextNum;
          currentFileName = buildEditedPhotoFileName(nextNum, activeDeviceType);

          // Create file in destination folder
          let jpegEntry = null;
          if (typeof destFolder.createFile === "function") {
            jpegEntry = await destFolder.createFile(currentFileName, { overwrite: false });
          } else {
            jpegEntry = { name: currentFileName };
          }
          assignedNumbers.add(nextNum);
          allOccupiedNumbers.add(nextNum);

          // Save JPEG (quality 12)
          if (typeof saveJpeg === "function") {
            await saveJpeg(smartDocOpened, jpegEntry, { quality: 12 });
          } else if (smartDocOpened.saveAs && typeof smartDocOpened.saveAs.jpg === "function") {
            await smartDocOpened.saveAs.jpg(jpegEntry, { quality: 12 }, true);
          } else {
            throw new Error("Photoshop saveAs.jpg API is not available on opened Smart Object document.");
          }

          // Close Smart Object document without saving
          if (typeof closeSmartObject === "function") {
            await closeSmartObject(smartDocOpened);
          }
          smartDocOpened = null;

          // Reactivate main document
          if (app && currentMainDoc && app.activeDocument !== currentMainDoc) {
            app.activeDocument = currentMainDoc;
          }

          successCount++;
          exportedFiles.push(currentFileName);
        }, "FM Save Edited Photos");
      } catch (layerErr) {
        const checkMainAfter = typeof findDocById === "function"
          ? findDocById(mainDocumentId, app)
          : (app?.documents ? Array.from(app.documents).find(d => d.id === mainDocumentId) : null);

        if (!checkMainAfter || layerErr instanceof DocumentClosedError || layerErr?.name === "DocumentClosedError") {
          logDiagnostic({
            stage: "resolve-main-document",
            mainDocumentId,
            mainDocumentName,
            error: layerErr
          });
          return {
            outcome: "document-closed",
            successCount,
            failedCount: failedCount + (smartObjectLayers.length - i),
            destinationFolder: destFolder,
            firstFailureError: firstFailureError || layerErr
          };
        }

        logDiagnostic({
          stage: "process-layer",
          mainDocumentId,
          mainDocumentName,
          layerId,
          layerName,
          exportNumber: currentExportNumber,
          fileName: currentFileName,
          smartObjectDocumentId: smartDocOpened?.id,
          smartObjectDocumentName: smartDocOpened?.name,
          error: layerErr
        });

        failedCount++;
        if (!firstFailureError) firstFailureError = layerErr;

        // Error cleanup: if smartDoc was opened, close it without saving
        if (smartDocOpened) {
          try {
            await runModal(async () => {
              if (typeof closeSmartObject === "function") {
                await closeSmartObject(smartDocOpened);
              }
              const currentMainDoc = typeof findDocById === "function"
                ? findDocById(mainDocumentId, app)
                : (app?.documents ? Array.from(app.documents).find(d => d.id === mainDocumentId) : null);
              if (app && currentMainDoc && app.activeDocument !== currentMainDoc) {
                app.activeDocument = currentMainDoc;
              }
            }, "FM Cleanup Smart Object");
          } catch (cleanupErr) {
            logDiagnostic({
              stage: "close-smart-object-cleanup",
              mainDocumentId,
              mainDocumentName,
              error: cleanupErr
            });
          }
          smartDocOpened = null;
        }
      }
    }
  } finally {
    // 6. Stage: selection restoration in cleanup phase
    try {
      await runModal(async () => {
        const currentMainDoc = typeof findDocById === "function"
          ? findDocById(mainDocumentId, app)
          : (app?.documents ? Array.from(app.documents).find(d => d.id === mainDocumentId) : null);

        if (currentMainDoc) {
          if (app && app.activeDocument !== currentMainDoc) {
            app.activeDocument = currentMainDoc;
          }

          const allDocLayers = typeof getAllLayers === "function"
            ? getAllLayers(currentMainDoc)
            : (currentMainDoc.layers ? flattenLayers(currentMainDoc.layers, []) : []);
          const existingDocLayerIds = new Set(allDocLayers.map(l => l.id));
          const idsToRestore = originalSelectedLayerIds.filter(id => existingDocLayerIds.has(id));

          if (idsToRestore.length > 0) {
            if (typeof selectLayers === "function") {
              await selectLayers(idsToRestore);
            } else if (currentMainDoc.activeLayers) {
              const matchingLayers = allDocLayers.filter(l => idsToRestore.includes(l.id));
              currentMainDoc.activeLayers = matchingLayers;
            }
          }
        }
      }, "FM Restore Selection");
    } catch (restoreErr) {
      logDiagnostic({
        stage: "restore-selection",
        mainDocumentId,
        mainDocumentName,
        error: restoreErr
      });
    }
  }

  if (successCount === 0 && failedCount > 0) {
    return {
      outcome: "failed",
      successCount: 0,
      failedCount,
      exportedFiles,
      destinationFolder: destFolder,
      firstFailureError
    };
  }

  return {
    outcome: "success",
    successCount,
    failedCount,
    exportedFiles,
    destinationFolder: destFolder,
    firstFailureError
  };
}

async function runSaveEditedPhotos(options = {}) {
  let psApp = null;
  let psCore = null;
  let uxpStorage = null;

  try {
    const photoshop = require("photoshop");
    psApp = photoshop.app;
    psCore = photoshop.core;
  } catch (_) {}

  try {
    const uxp = require("uxp");
    uxpStorage = uxp.storage;
  } catch (_) {}

  return executeSaveEditedPhotos(
    {
      app: psApp,
      core: psCore,
      localFileSystem: uxpStorage?.localFileSystem,
      storage: typeof localStorage !== "undefined" ? localStorage : null,
      ...options
    },
    options
  );
}

module.exports = {
  FOLDER_TOKEN_KEY,
  DEVICE_STORAGE_KEY,
  FILENAME_REGEX,
  normalizeDeviceType,
  isValidDeviceType,
  getStoredDeviceType,
  saveDeviceType,
  extractEditedPhotoNumber,
  findNextEditedPhotoNumber,
  buildEditedPhotoFileName,
  isSmartObjectLayer,
  buildSaveEditedPhotosToast,
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  logDiagnostic,
  DocumentClosedError,
  executeSaveEditedPhotos,
  runSaveEditedPhotos
};
