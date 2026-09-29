"use strict";

const { readBounds, px } = require("../photoshop");
const {
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  restoreFolderFromToken,
  saveFolderToken,
  getFolderDisplayPath
} = require("../folderMemory");

const BACKGROUND_FOLDER_STORAGE_KEY = "mm_background_folder_token";
const HISTORY_STATE_NAME = "Change Background";

function isBackgroundFile(entry) {
  return Boolean(entry?.isFile && !entry.isFolder && /\.(jpe?g|png)$/i.test(entry.name || ""));
}

function getBackgroundLayerName(name) {
  return typeof name === "string" ? name.replace(/\.(jpe?g|png)$/i, "") || "Background" : "Background";
}

function getStoredBackgroundFolderToken(storage) {
  return getStoredValue(BACKGROUND_FOLDER_STORAGE_KEY, storage);
}

function clearBackgroundFolderToken(storage) {
  removeStoredValue(BACKGROUND_FOLDER_STORAGE_KEY, storage);
}

async function validateBackgroundFolder(folder) {
  if (folder?.isFolder !== true || typeof folder.getEntries !== "function") {
    throw new Error("Select a readable Background Root Folder.");
  }
  await folder.getEntries();
}

async function resolveBackgroundFolder({ localFileSystem, storage } = {}) {
  if (!getStoredBackgroundFolderToken(storage)) {
    return { folder: null, wasRemembered: false };
  }
  try {
    const folder = await restoreFolderFromToken(BACKGROUND_FOLDER_STORAGE_KEY, localFileSystem, storage);
    await validateBackgroundFolder(folder);
    return { folder, wasRemembered: true };
  } catch (_) {
    clearBackgroundFolderToken(storage);
    return { folder: null, wasRemembered: false };
  }
}

async function changeBackgroundFolder({ localFileSystem, storage, promptForFolder, currentFolder = null } = {}) {
  const pick = promptForFolder || (typeof localFileSystem?.getFolder === "function" ? () => localFileSystem.getFolder() : null);
  if (!pick) throw new Error("Folder selection API is not available.");
  const selected = await pick();
  if (!selected) return { folder: currentFolder, changed: false, cancelled: true };
  await validateBackgroundFolder(selected);
  const previousToken = getStoredBackgroundFolderToken(storage);
  const token = await saveFolderToken(BACKGROUND_FOLDER_STORAGE_KEY, selected, localFileSystem, storage);
  if (!token) {
    if (previousToken) setStoredValue(BACKGROUND_FOLDER_STORAGE_KEY, previousToken, storage);
    else clearBackgroundFolderToken(storage);
    throw new Error("Could not remember the Background Root Folder. Please try again.");
  }
  return { folder: selected, changed: true };
}

async function selectBackgroundImage({ folder, localFileSystem } = {}) {
  await validateBackgroundFolder(folder);
  if (typeof localFileSystem?.getFileForOpening !== "function") {
    throw new Error("Background file selection API is not available.");
  }
  const selected = await localFileSystem.getFileForOpening({
    initialLocation: folder,
    types: ["jpg", "jpeg", "png"],
    allowMultiple: false
  });
  const file = Array.isArray(selected) ? selected[0] : selected;
  if (!file) return null;
  if (!isBackgroundFile(file)) {
    throw new Error("Choose a JPG, JPEG, or PNG background image.");
  }
  return file;
}

function findBottomMostTopLevelLayer(targetDocument) {
  if (!targetDocument || !targetDocument.layers) return null;
  const layers = Array.from(targetDocument.layers);
  return layers.length > 0 ? layers[layers.length - 1] : null;
}

function isSafeBackgroundCandidate(layer) {
  return Boolean(layer);
}

function calculateCoverScale({ imageWidth, imageHeight, canvasWidth, canvasHeight } = {}) {
  if (![imageWidth, imageHeight, canvasWidth, canvasHeight].every(v => Number.isFinite(v) && v > 0)) {
    throw new Error("The image has no usable bounds.");
  }
  const scaleFactor = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
  return {
    scalePercent: scaleFactor * 100,
    scaleFactor
  };
}

function calculateCenterTranslation({ imageBounds, canvasWidth, canvasHeight }) {
  return {
    dx: canvasWidth / 2 - (imageBounds.left + imageBounds.right) / 2,
    dy: canvasHeight / 2 - (imageBounds.top + imageBounds.bottom) / 2
  };
}

function activeDocument(app) {
  if (!app?.documents?.length) return null;
  try { return app.activeDocument || null; } catch (_) { return null; }
}

function allLayers(layers) {
  const result = [];
  for (const layer of Array.from(layers || [])) {
    result.push(layer);
    if (layer.layers) result.push(...allLayers(layer.layers));
  }
  return result;
}

async function nativeAction(ps, command) {
  const results = await ps.action.batchPlay([command], {});
  const failure = results?.find(result => /error/i.test(result?._obj || "") || result?.result < 0);
  if (failure) {
    const error = new Error(failure.message || "Photoshop operation failed.");
    error.nativeResult = failure;
    throw error;
  }
  return results;
}

async function deleteOldBottomLayer(layer, ps) {
  if (!layer) return;

  if (layer.isBackgroundLayer) {
    try { layer.isBackgroundLayer = false; } catch (_) {}
  }
  if (layer.allLocked) {
    try { layer.allLocked = false; } catch (_) {}
  }

  try {
    if (typeof layer.delete === "function") {
      await layer.delete();
      return;
    }
  } catch (domErr) {
    try {
      if (layer.id !== undefined && ps?.action?.batchPlay) {
        try {
          await nativeAction(ps, {
            _obj: "set",
            _target: [{ _ref: "layer", _id: layer.id }],
            to: {
              _obj: "layer",
              isBackground: false,
              layerLocking: {
                _obj: "layerLocking",
                protectAll: false
              }
            },
            _options: { dialogOptions: "dontDisplay" }
          });
        } catch (_) {}

        await nativeAction(ps, {
          _obj: "delete",
          _target: [{ _ref: "layer", _id: layer.id }],
          _options: { dialogOptions: "dontDisplay" }
        });
        return;
      }
      throw domErr;
    } catch (nativeErr) {
      console.error("[CHANGE BG] Native deletion failed:", nativeErr);
      throw nativeErr;
    }
  }

  if (layer.id !== undefined && ps?.action?.batchPlay) {
    try {
      await nativeAction(ps, {
        _obj: "delete",
        _target: [{ _ref: "layer", _id: layer.id }],
        _options: { dialogOptions: "dontDisplay" }
      });
    } catch (nativeErr) {
      console.error("[CHANGE BG] Native deletion failed:", nativeErr);
      throw nativeErr;
    }
  }
}

async function convertToBackgroundLayer(layer, ps, target) {
  if (!layer) throw new Error("No layer to convert to Background.");

  if (typeof layer.select === "function") {
    try { await layer.select(); } catch (_) {}
  }
  if (target?.activeLayers) {
    try { target.activeLayers = [layer]; } catch (_) {}
  }

  await nativeAction(ps, {
    _obj: "make",
    _target: [{ _ref: "backgroundLayer" }],
    using: {
      _ref: "layer",
      _enum: "ordinal",
      _value: "targetEnum"
    },
    _options: { dialogOptions: "dontDisplay" }
  });

  try {
    layer.isBackgroundLayer = true;
    layer.kind = "background";
    layer.name = "Background";
  } catch (_) {}
}

async function applyNewBackground({ fileEntry, targetDocument, photoshop, localFileSystem } = {}) {
  const ps = photoshop || require("photoshop");
  const target = targetDocument || activeDocument(ps.app);
  if (!target) {
    return { outcome: "no-document", success: false, message: "Create or open a page first." };
  }

  const topLayers = Array.from(target.layers || []);
  if (topLayers.length === 0) {
    return { outcome: "no-layers", success: false, message: "No layer available to replace." };
  }

  // Authoritative Rule: The old background candidate is ALWAYS the bottom-most TOP-LEVEL layer.
  const oldBottomLayer = topLayers[topLayers.length - 1];

  console.log(`[CHANGE BG] Target document: ${target.name || target.id || "Document"}`);
  console.log(`[CHANGE BG] Top-level layer count: ${topLayers.length}`);
  console.log(`[CHANGE BG] Bottom candidate: ${oldBottomLayer.name || "Unnamed"}`);
  console.log(`[CHANGE BG] Bottom kind: ${oldBottomLayer.kind !== undefined ? oldBottomLayer.kind : (oldBottomLayer.typename || "unknown")}`);

  if (typeof localFileSystem?.createSessionToken !== "function") {
    throw new Error("File placement API is not available.");
  }
  const token = await localFileSystem.createSessionToken(fileEntry);

  return await ps.core.executeAsModal(async context => {
    if (!Array.from(ps.app.documents).some(doc => doc.id === target.id)) {
      return { outcome: "no-document", success: false, message: "Create or open a page first." };
    }
    ps.app.activeDocument = target;
    const host = context?.hostControl;
    if (!host?.suspendHistory || !host?.resumeHistory) {
      throw new Error("Photoshop history API is not available.");
    }

    const previousIds = new Set(allLayers(target.layers).map(l => l.id));
    const suspension = await host.suspendHistory({ documentID: target.id, name: HISTORY_STATE_NAME });
    let complete = false;
    let placedLayer = null;

    try {
      // Place as Embedded Smart Object
      await nativeAction(ps, {
        _obj: "placeEvent",
        null: { _path: token, _kind: "local" },
        linked: false,
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
        _options: { dialogOptions: "dontDisplay" }
      });

      const currentLayers = allLayers(target.layers);
      placedLayer = currentLayers.find(l => !previousIds.has(l.id)) || target.activeLayers?.[0];
      if (!placedLayer) {
        throw new Error("Photoshop did not select the newly placed background layer.");
      }

      console.log("[CHANGE BG] New background placed");

      // Rename layer using source filename without extension
      placedLayer.name = getBackgroundLayerName(fileEntry.name);

      // COVER FIT & Centering
      const cw = px(target.width);
      const ch = px(target.height);
      const b = readBounds(placedLayer);
      const iw = b.right - b.left;
      const ih = b.bottom - b.top;

      const { scalePercent } = calculateCoverScale({
        imageWidth: iw,
        imageHeight: ih,
        canvasWidth: cw,
        canvasHeight: ch
      });

      await placedLayer.scale(scalePercent, scalePercent, ps.constants?.AnchorPosition?.MIDDLECENTER || "middleCenter");

      const fittedBounds = readBounds(placedLayer);
      const { dx, dy } = calculateCenterTranslation({
        imageBounds: fittedBounds,
        canvasWidth: cw,
        canvasHeight: ch
      });
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        await placedLayer.translate(dx, dy);
      }

      console.log("[CHANGE BG] New background fitted");

      // Clear clipping state
      if (placedLayer.isClippingMask) placedLayer.isClippingMask = false;
      if (placedLayer.grouped) placedLayer.grouped = false;

      // Move new background immediately ABOVE oldBottomLayer first
      if (oldBottomLayer && typeof placedLayer.move === "function") {
        try {
          await placedLayer.move(oldBottomLayer, ps.constants?.ElementPlacement?.PLACEBEFORE || "placeBefore");
        } catch (_) {
          try {
            await placedLayer.move(target, ps.constants?.ElementPlacement?.PLACEATEND || "placeAtEnd");
          } catch (_) {}
        }
      } else if (typeof placedLayer.move === "function") {
        try {
          await placedLayer.move(target, ps.constants?.ElementPlacement?.PLACEATEND || "placeAtEnd");
        } catch (_) {}
      }

      console.log("[CHANGE BG] New background moved above old bottom");

      // Delete oldBottomLayer
      await deleteOldBottomLayer(oldBottomLayer, ps);
      console.log("[CHANGE BG] Old bottom removed");

      // Convert New Background to true Photoshop Background Layer
      console.log("[CHANGE BG] Converting new layer to Background");
      let conversionWarning = null;
      let finalBackgroundLayer = placedLayer;
      try {
        await convertToBackgroundLayer(placedLayer, ps, target);
        console.log("[CHANGE BG] Background conversion completed");
        const finalLayers = Array.from(target.layers || []);
        if (finalLayers.length > 0) {
          finalBackgroundLayer = finalLayers[finalLayers.length - 1];
        }
      } catch (convErr) {
        console.error(`[CHANGE BG] Background conversion failed: ${convErr?.message || convErr}`);
        conversionWarning = "Background changed, but could not convert it to a Background layer.";
      }

      // Ensure new background remains selected
      if (typeof finalBackgroundLayer.select === "function") {
        try { await finalBackgroundLayer.select(); } catch (_) {}
      }
      if (target.activeLayers) {
        target.activeLayers = [finalBackgroundLayer];
      }

      ps.app.activeDocument = target;
      complete = true;

      console.log("[CHANGE BG] Completed");

      if (conversionWarning) {
        return {
          outcome: "conversion-warning",
          success: true,
          warning: true,
          layer: finalBackgroundLayer,
          layerName: finalBackgroundLayer.name,
          fileName: fileEntry.name,
          message: conversionWarning
        };
      }

      return {
        outcome: "success",
        success: true,
        layer: finalBackgroundLayer,
        layerName: finalBackgroundLayer.name,
        fileName: fileEntry.name,
        message: `Changed background to ${finalBackgroundLayer.name}.`
      };
    } catch (error) {
      if (placedLayer) {
        try { await placedLayer.delete(); } catch (_) {}
      }
      throw error;
    } finally {
      ps.app.activeDocument = target;
      try {
        await host.resumeHistory(suspension, complete);
      } catch (historyError) {
        if (!complete && placedLayer) {
          try { await placedLayer.delete(); } catch (_) {}
        }
        throw historyError;
      }
    }
  }, { commandName: HISTORY_STATE_NAME });
}

async function runChangeBackground({
  promptForFolder,
  showChangeBackgroundDialog,
  photoshop,
  localFileSystem,
  storage,
  onResult
} = {}) {
  const ps = photoshop || require("photoshop");
  const target = activeDocument(ps.app);
  if (!target) {
    const res = { outcome: "no-document", success: false, message: "Create or open a page first." };
    onResult?.(res);
    return res;
  }

  const topLayers = Array.from(target.layers || []);
  if (topLayers.length === 0) {
    const res = { outcome: "no-layers", success: false, message: "No layer available to replace." };
    onResult?.(res);
    return res;
  }

  let folder = null;
  const resolved = await resolveBackgroundFolder({ localFileSystem, storage });
  folder = resolved.folder;

  let currentMessage = "";
  while (true) {
    const folderPath = folder ? await getFolderDisplayPath(folder, localFileSystem) : "";
    const dialogResult = await showChangeBackgroundDialog({
      folder,
      folderPath,
      message: currentMessage
    });

    if (!dialogResult || dialogResult.action === "cancel") {
      return { outcome: "cancelled", cancelled: true, message: "Change Background cancelled." };
    }

    if (dialogResult.action === "set-folder" || dialogResult.action === "change-folder") {
      try {
        const changeResult = await changeBackgroundFolder({
          localFileSystem,
          storage,
          promptForFolder,
          currentFolder: folder
        });
        if (changeResult.changed) {
          folder = changeResult.folder;
          currentMessage = "";
        }
      } catch (err) {
        currentMessage = err?.message || "Could not set folder.";
      }
      continue;
    }

    if (dialogResult.action === "select") {
      if (!folder) {
        currentMessage = "Set a background folder first.";
        continue;
      }

      let file = null;
      try {
        file = await selectBackgroundImage({ folder, localFileSystem });
      } catch (err) {
        currentMessage = err?.message || "File selection failed.";
        continue;
      }

      if (!file) {
        // Picker was cancelled by user; return to dialog or finish
        return { outcome: "cancelled", cancelled: true, message: "Background selection cancelled." };
      }

      try {
        const result = await applyNewBackground({
          fileEntry: file,
          targetDocument: target,
          photoshop: ps,
          localFileSystem
        });
        onResult?.(result);
        return result;
      } catch (err) {
        console.error("[CHANGE BACKGROUND] Failed to apply new background:", err);
        const failRes = {
          outcome: "error",
          success: false,
          error: err,
          message: err?.message || "Could not change background."
        };
        onResult?.(failRes);
        return failRes;
      }
    }
  }
}

function buildChangeBackgroundToast(result) {
  if (!result) return null;
  if (result.outcome === "conversion-warning" || (result.success && result.warning)) {
    return {
      message: result.message || "Background changed, but could not convert it to a Background layer.",
      type: "warning"
    };
  }
  if (result.outcome === "success") {
    return { message: result.message || `Changed background to ${result.layerName || "image"}.`, type: "success" };
  }
  if (result.outcome === "no-document") {
    return { message: "Create or open a page first.", type: "warning" };
  }
  if (result.outcome === "no-layers") {
    return { message: result.message || "No layer available to replace.", type: "warning" };
  }
  if (result.outcome === "error") {
    return { message: result.message || "Change Background failed.", type: "error" };
  }
  return null;
}

module.exports = {
  BACKGROUND_FOLDER_STORAGE_KEY,
  HISTORY_STATE_NAME,
  isBackgroundFile,
  getBackgroundLayerName,
  getStoredBackgroundFolderToken,
  clearBackgroundFolderToken,
  validateBackgroundFolder,
  resolveBackgroundFolder,
  changeBackgroundFolder,
  selectBackgroundImage,
  findBottomMostTopLevelLayer,
  isSafeBackgroundCandidate,
  calculateCoverScale,
  calculateCenterTranslation,
  deleteOldBottomLayer,
  convertToBackgroundLayer,
  applyNewBackground,
  runChangeBackground,
  buildChangeBackgroundToast
};
