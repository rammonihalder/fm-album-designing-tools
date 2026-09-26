"use strict";

const {
  TOKEN_KEYS,
  restoreFolderFromToken,
  saveFolderToken,
  getParentFolder
} = require("../folderMemory");

const KEYWORDS = Object.freeze([
  "studio",
  "digital",
  "color",
  "lab",
  "graphics",
  "album",
  "photo",
  "photography",
  "creation"
]);

function matchesKeyword(name) {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  return KEYWORDS.some(kw => lower.includes(kw));
}

function getParentDuplicateNames(siblingLayers) {
  const counts = new Map();
  if (!siblingLayers || !siblingLayers.length) return new Set();

  for (const layer of siblingLayers) {
    if (!layer || typeof layer.name !== "string") continue;
    const lower = layer.name.toLowerCase();
    counts.set(lower, (counts.get(lower) || 0) + 1);
  }

  const duplicates = new Set();
  for (const [name, count] of counts.entries()) {
    if (count > 1) {
      duplicates.add(name);
    }
  }
  return duplicates;
}

function isGroupLayer(layer) {
  if (!layer) return false;
  if (layer.typename === "LayerSet") return true;
  if (layer.kind === "group" || layer.kind === 7) return true;
  try {
    const photoshop = require("photoshop");
    if (
      photoshop?.constants?.LayerKind?.GROUP !== undefined &&
      layer.kind === photoshop.constants.LayerKind.GROUP
    ) {
      return true;
    }
  } catch (_) {}
  if (Array.isArray(layer.layers) && layer.kind !== "smartObject") {
    return true;
  }
  return false;
}

function isTextLayer(layer) {
  if (!layer) return false;
  const kindStr = String(layer.kind || "").toLowerCase();
  if (kindStr === "text" || layer.kind === 3) return true;
  if (Boolean(layer.textItem)) return true;
  try {
    const photoshop = require("photoshop");
    if (
      photoshop?.constants?.LayerKind?.TEXT !== undefined &&
      (layer.kind === photoshop.constants.LayerKind.TEXT ||
        String(photoshop.constants.LayerKind.TEXT).toLowerCase() === kindStr)
    ) {
      return true;
    }
  } catch (_) {}
  return false;
}

function isBackgroundLayer(layer) {
  if (!layer) return false;
  return Boolean(layer.isBackgroundLayer || layer.background || layer.kind === "background");
}

function isClippedLayer(layer) {
  if (!layer) return false;
  return Boolean(layer.isClippingMask || layer.grouped || layer.clipped);
}

function shouldSkipLayer(layer) {
  if (!layer) return true;
  if (layer.visible === false) return true;
  if (isBackgroundLayer(layer)) return true;
  if (isTextLayer(layer)) return true;
  if (isClippedLayer(layer)) return true;
  if (isGroupLayer(layer)) return true;
  return false;
}

function isRenameCandidate(layer, duplicateNamesSet) {
  if (!layer || isGroupLayer(layer)) return false;
  const name = typeof layer.name === "string" ? layer.name : "";
  const isKeyword = matchesKeyword(name);
  const isDuplicate = duplicateNamesSet ? duplicateNamesSet.has(name.toLowerCase()) : false;
  return isKeyword || isDuplicate;
}

function formatLayerName(index) {
  const padded = String(index).padStart(2, "0");
  return `${padded} MMR | 7001514367`;
}

function smartRenameContainer(container, counterRef, docName) {
  const layers = container ? container.layers : null;
  if (!layers || !layers.length) return;

  const duplicateNamesSet = getParentDuplicateNames(layers);

  // Traverse from length - 1 down to 0 (bottom-to-top)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer) continue;

    if (isGroupLayer(layer)) {
      smartRenameContainer(layer, counterRef, docName);
    } else {
      if (isRenameCandidate(layer, duplicateNamesSet)) {
        if (!shouldSkipLayer(layer)) {
          const newName = formatLayerName(counterRef.value++);
          try {
            layer.name = newName;
          } catch (renameErr) {
            console.warn("[MM Open PSD] Could not rename layer:", {
              documentName: docName || "unknown",
              layerName: layer.name,
              layerId: layer.id,
              errorMessage: renameErr ? renameErr.message : String(renameErr)
            });
          }
        }
      }
    }
  }
}

function smartRenameDocument(doc) {
  if (!doc) return;
  const counterRef = { value: 1 };
  smartRenameContainer(doc, counterRef, doc.name);
}

function approx(value, target, tolerance = 0.05) {
  return typeof value === "number" && Math.abs(value - target) <= tolerance;
}

function classifyAlbumSize(pixelWidth, pixelHeight, resolution = 300) {
  const res = Number(resolution) > 0 ? Number(resolution) : 300;
  const widthInches = (Number(pixelWidth) || 0) / res;
  const heightInches = (Number(pixelHeight) || 0) / res;

  if (approx(widthInches, 36) && approx(heightInches, 12)) {
    return "36x12";
  }
  if (approx(widthInches, 18) && approx(heightInches, 12)) {
    return "18x12";
  }
  return "unsupported";
}

function getTargetDimensions(format) {
  if (format === "18x12" || format === "native-18x12") {
    return { targetWidth: 5400, targetHeight: 3600, targetDpi: 300 };
  }
  // 36x12, unsupported, or fallback
  return { targetWidth: 10800, targetHeight: 3600, targetDpi: 300 };
}

function calculateAlbumGuides(width, height) {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);

  const centerFold = w / 2;
  const safeMargin = 150;
  const bleed = 100;

  const verticalGuides = [
    bleed,
    safeMargin,
    centerFold,
    w - safeMargin,
    w - bleed
  ].sort((a, b) => a - b);

  const horizontalGuides = [
    bleed,
    safeMargin,
    h - safeMargin,
    h - bleed
  ].sort((a, b) => a - b);

  return {
    verticalGuides,
    horizontalGuides
  };
}

function buildOpenPsdToast(result) {
  if (!result || result.outcome === "cancelled") {
    return { message: "Cancelled", type: "info" };
  }
  if (result.outcome === "error" || (result.successCount === 0 && result.failureCount > 0)) {
    return { message: "Open PSD failed", type: "error" };
  }

  const success = result.successCount || 0;
  const failure = result.failureCount || 0;
  const psdWord = success === 1 ? "PSD" : "PSDs";
  const openedPart = `${success} ${psdWord} opened`;

  if (failure > 0) {
    return {
      message: `${openedPart} • ${failure} failed`,
      type: "warning"
    };
  }

  return {
    message: openedPart,
    type: "success"
  };
}

async function executeOpenPsd(dependencies = {}, options = {}) {
  const {
    selectPsdFiles,
    openDocument,
    ensureActiveDocument,
    setActiveDocument,
    executeModal,
    smartRenameLayers = smartRenameDocument,
    getDocumentMetrics,
    normalizeDocumentToPixels,
    clearAllGuides,
    addAlbumGuides,
    classifySize = classifyAlbumSize,
    getTargetDims = getTargetDimensions,
    calculateGuides = calculateAlbumGuides
  } = dependencies;

  const onProgress = options.onProgress;

  if (typeof selectPsdFiles !== "function") {
    throw new Error("Missing required selectPsdFiles dependency.");
  }

  const storage = dependencies.storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const localFileSystem = dependencies.localFileSystem || null;

  let restoredFolder = null;
  if (localFileSystem && storage) {
    try {
      restoredFolder = await restoreFolderFromToken(TOKEN_KEYS.OPEN_PSD, localFileSystem, storage);
    } catch (_) {}
  }

  const fileEntries = await selectPsdFiles({ initialLocation: restoredFolder });
  if (!fileEntries || !fileEntries.length) {
    return {
      outcome: "cancelled",
      successCount: 0,
      failureCount: 0,
      totalCount: 0
    };
  }

  if (localFileSystem && storage && fileEntries.length > 0) {
    try {
      const parentFolder = await getParentFolder(fileEntries[0], localFileSystem);
      if (parentFolder) {
        await saveFolderToken(TOKEN_KEYS.OPEN_PSD, parentFolder, localFileSystem, storage);
      }
    } catch (_) {}
  }

  const total = fileEntries.length;
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < total; i++) {
    const fileEntry = fileEntries[i];
    let stage = "open-file";
    let documentName = fileEntry ? fileEntry.name : `PSD ${i + 1}`;
    let pixelWidth = null;
    let pixelHeight = null;
    let resolution = null;
    let widthInches = null;
    let heightInches = null;
    let targetWidth = null;
    let targetHeight = null;
    let targetDpi = 300;

    if (onProgress) {
      try {
        onProgress(i + 1, total);
      } catch (_) {}
    }

    try {
      const processDocModal = async (executionContext) => {
        // 1. open-file
        stage = "open-file";
        const doc = await openDocument(fileEntry);
        if (!doc) {
          throw new Error(`Failed to open PSD for file "${documentName}".`);
        }
        documentName = doc.name || documentName;

        // Ensure opened document is active if needed
        if (typeof ensureActiveDocument === "function") {
          ensureActiveDocument(doc);
        } else if (typeof setActiveDocument === "function") {
          setActiveDocument(doc);
        }

        // 2. read-metrics
        stage = "read-metrics";
        let metrics;
        if (typeof getDocumentMetrics === "function") {
          metrics = await getDocumentMetrics(doc);
        } else {
          const rawRes = doc.resolution || 300;
          const resVal = typeof rawRes === "number" ? rawRes : Number(rawRes?.value ?? rawRes) || 300;
          const wVal = typeof doc.width === "number" ? doc.width : Number(doc.width?.value ?? doc.width) || 0;
          const hVal = typeof doc.height === "number" ? doc.height : Number(doc.height?.value ?? doc.height) || 0;
          metrics = {
            name: documentName,
            pixelWidth: Math.round(wVal),
            pixelHeight: Math.round(hVal),
            resolution: resVal,
            widthInches: resVal > 0 ? wVal / resVal : 0,
            heightInches: resVal > 0 ? hVal / resVal : 0
          };
        }

        pixelWidth = metrics.pixelWidth;
        pixelHeight = metrics.pixelHeight;
        resolution = metrics.resolution;
        widthInches = metrics.widthInches;
        heightInches = metrics.heightInches;

        // 3. classify-size
        stage = "classify-size";
        const detectedFormat = classifySize(pixelWidth, pixelHeight, resolution);
        const targetDims = getTargetDims(detectedFormat);
        targetWidth = targetDims.targetWidth;
        targetHeight = targetDims.targetHeight;
        targetDpi = targetDims.targetDpi;

        console.log("[Open PSD] document metrics", {
          name: documentName,
          pixelWidth,
          pixelHeight,
          resolution,
          widthInches,
          heightInches,
          detectedFormat
        });

        // 4. rename
        stage = "rename";
        smartRenameLayers(doc);

        // 5. normalize-size
        stage = "normalize-size";
        const isAlreadyTarget =
          pixelWidth === targetWidth &&
          pixelHeight === targetHeight &&
          Math.abs(resolution - targetDpi) < 1;

        if (!isAlreadyTarget) {
          if (typeof normalizeDocumentToPixels === "function") {
            await normalizeDocumentToPixels(doc, targetWidth, targetHeight, targetDpi);
          }
        }

        // 6. verify-size
        stage = "verify-size";
        let postMetrics;
        if (typeof getDocumentMetrics === "function") {
          postMetrics = await getDocumentMetrics(doc);
        } else {
          const rawRes = doc.resolution || targetDpi;
          const resVal = typeof rawRes === "number" ? rawRes : Number(rawRes?.value ?? rawRes) || targetDpi;
          const wVal = typeof doc.width === "number" ? doc.width : Number(doc.width?.value ?? doc.width) || 0;
          const hVal = typeof doc.height === "number" ? doc.height : Number(doc.height?.value ?? doc.height) || 0;
          postMetrics = {
            name: documentName,
            pixelWidth: Math.round(wVal),
            pixelHeight: Math.round(hVal),
            resolution: resVal,
            widthInches: resVal > 0 ? Math.round((wVal / resVal) * 1000) / 1000 : 0,
            heightInches: resVal > 0 ? Math.round((hVal / resVal) * 1000) / 1000 : 0
          };
        }

        // Update tracking variables with fresh post-resize metrics
        pixelWidth = postMetrics.pixelWidth;
        pixelHeight = postMetrics.pixelHeight;
        resolution = postMetrics.resolution;
        widthInches = postMetrics.widthInches;
        heightInches = postMetrics.heightInches;

        if (postMetrics.rawDescriptor) {
          console.log("[OPEN PSD RAW METRICS]", postMetrics.rawDescriptor);
        }
        console.log("[OPEN PSD NORMALIZED METRICS]", {
          pixelWidth: postMetrics.pixelWidth,
          pixelHeight: postMetrics.pixelHeight,
          resolution: postMetrics.resolution,
          widthInches: postMetrics.widthInches,
          heightInches: postMetrics.heightInches
        });

        const widthOk = postMetrics.pixelWidth === targetWidth;
        const heightOk = postMetrics.pixelHeight === targetHeight;
        const dpiOk = Math.abs(postMetrics.resolution - targetDpi) <= 1;

        if (!widthOk || !heightOk || !dpiOk) {
          throw new Error(
            `Open PSD normalization failed: expected ${targetWidth}x${targetHeight} @${targetDpi}, got ${postMetrics.pixelWidth}x${postMetrics.pixelHeight} @${postMetrics.resolution}`
          );
        }

        // 7. clear-guides
        stage = "clear-guides";
        if (typeof clearAllGuides === "function") {
          await clearAllGuides(doc);
        }

        // 8. add-guides
        stage = "add-guides";
        const guides = calculateGuides(targetWidth, targetHeight);
        if (typeof addAlbumGuides === "function") {
          await addAlbumGuides(doc, guides);
        }

        // Document remains open (no save, no close)
        return doc;
      };

      if (typeof executeModal === "function") {
        await executeModal(processDocModal, `MM Open PSD - ${documentName}`);
      } else {
        await processDocModal();
      }

      successCount++;
    } catch (error) {
      failureCount++;
      console.error("[OPEN PSD]", {
        stage,
        documentName,
        pixelWidth,
        pixelHeight,
        resolution,
        widthInches,
        heightInches,
        targetWidth,
        targetHeight,
        targetDpi,
        errorName: error?.name,
        errorMessage: error?.message || error?.description || String(error),
        stack: error?.stack
      });
    }
  }

  const outcome =
    successCount > 0 && failureCount === 0
      ? "success"
      : successCount > 0 && failureCount > 0
        ? "partial"
        : "error";

  return {
    outcome,
    successCount,
    failureCount,
    totalCount: total
  };
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
    storage: typeof localStorage !== "undefined" ? localStorage : null,
    localFileSystem: fs,
    selectPsdFiles: async (pickerOptions = {}) => {
      const opts = {
        types: ["psd"],
        allowMultiple: true
      };
      if (pickerOptions && pickerOptions.initialLocation) {
        opts.initialLocation = pickerOptions.initialLocation;
      }
      const result = await fs.getFileForOpening(opts);
      if (!result) return null;
      const files = Array.isArray(result) ? result : [result];
      return files.length > 0 ? files : null;
    },
    openDocument: async fileEntry => {
      return app.open(fileEntry);
    },
    ensureActiveDocument: doc => {
      if (doc && app && app.activeDocument && app.activeDocument.id !== doc.id) {
        try {
          app.activeDocument = doc;
        } catch (_) {}
      }
    },
    setActiveDocument: doc => {
      if (doc && app && app.activeDocument && app.activeDocument.id !== doc.id) {
        try {
          app.activeDocument = doc;
        } catch (_) {}
      }
    },
    executeModal: async (fn, commandName) => {
      if (psHelpers && typeof psHelpers.executeOpenPsdModal === "function") {
        return psHelpers.executeOpenPsdModal(fn, commandName);
      }
      if (core && typeof core.executeAsModal === "function") {
        return core.executeAsModal(async (executionContext) => fn(executionContext), {
          commandName: commandName || "MM Open PSD"
        });
      }
      return fn();
    },
    smartRenameLayers: smartRenameDocument,
    getDocumentMetrics: psHelpers.getDocumentMetrics,
    normalizeDocumentToPixels: psHelpers.normalizeDocumentToPixels,
    clearAllGuides: psHelpers.clearAllGuides,
    addAlbumGuides: psHelpers.addAlbumGuides,
    classifySize: classifyAlbumSize,
    getTargetDims: getTargetDimensions,
    calculateGuides: calculateAlbumGuides
  };
}

async function runOpenPsd(options = {}) {
  return executeOpenPsd(getDefaultDependencies(), options);
}

module.exports = {
  KEYWORDS,
  matchesKeyword,
  getParentDuplicateNames,
  isGroupLayer,
  isTextLayer,
  isBackgroundLayer,
  isClippedLayer,
  shouldSkipLayer,
  isRenameCandidate,
  formatLayerName,
  smartRenameContainer,
  smartRenameDocument,
  approx,
  classifyAlbumSize,
  getTargetDimensions,
  calculateAlbumGuides,
  buildOpenPsdToast,
  executeOpenPsd,
  runOpenPsd,
  getDefaultDependencies
};
