"use strict";
const { readBounds, px } = require("../photoshop");
const { getStoredValue, setStoredValue, removeStoredValue, restoreFolderFromToken, saveFolderToken, getFolderDisplayPath } = require("../folderMemory");

function category(type, title, storageKey, historyName, noun) {
  return Object.freeze({ type, title, storageKey, historyName, noun, selectLabel: `SELECT ${title}`,
    fileTypes: Object.freeze(["png"]), layerPrefix: "", fitPercent: 0.8, errorMessage: `Could not add ${noun}.` });
}
const ASSET_CONFIGS = Object.freeze({
  "png-mask": category("png-mask", "PNG MASK", "mm_png_mask_folder_token", "Add PNG Mask", "PNG mask"),
  "png-text": category("png-text", "PNG TEXT", "mm_png_text_folder_token", "Add PNG Text", "PNG text"),
  "clip-art": category("clip-art", "CLIP ART", "mm_clip_art_folder_token", "Add Clip Art", "clip art")
});
function getAssetConfig(type) {
  const config = ASSET_CONFIGS[type];
  if (!config) throw new Error("Unknown asset category.");
  return config;
}
function isPngFile(entry) { return Boolean(entry?.isFile && !entry.isFolder && /\.png$/i.test(entry.name || "")); }
async function validateFolder(folder) {
  if (folder?.isFolder !== true || typeof folder.getEntries !== "function") throw new Error("Select a readable root folder.");
  // Accessibility check only; the native file picker handles browsing.
  await folder.getEntries();
}
async function resolveAssetFolder({ config, localFileSystem, storage }) {
  if (!getStoredValue(config.storageKey, storage)) return { folder: null };
  try {
    const folder = await restoreFolderFromToken(config.storageKey, localFileSystem, storage);
    await validateFolder(folder);
    return { folder };
  } catch (_) {
    removeStoredValue(config.storageKey, storage);
    return { folder: null };
  }
}
async function changeAssetFolder({ config, localFileSystem, storage, currentFolder = null }) {
  if (typeof localFileSystem?.getFolder !== "function") throw new Error("Folder selection API is not available.");
  const folder = await localFileSystem.getFolder();
  if (!folder) return { folder: currentFolder, changed: false, cancelled: true };
  await validateFolder(folder);
  const previous = getStoredValue(config.storageKey, storage);
  if (!await saveFolderToken(config.storageKey, folder, localFileSystem, storage)) {
    if (previous) setStoredValue(config.storageKey, previous, storage);
    else removeStoredValue(config.storageKey, storage);
    throw new Error(`Could not remember the ${config.title} root folder. Please try again.`);
  }
  return { folder, changed: true };
}
async function selectPngAsset({ config, folder, localFileSystem }) {
  await validateFolder(folder);
  if (typeof localFileSystem?.getFileForOpening !== "function") throw new Error("PNG file selection API is not available.");
  const selection = await localFileSystem.getFileForOpening({ initialLocation: folder, types: [...config.fileTypes], allowMultiple: false });
  const file = Array.isArray(selection) ? selection[0] : selection;
  if (!file) return null;
  if (!isPngFile(file)) throw new Error(`Choose a ${config.noun} PNG file.`);
  return file;
}
function activeDocument(app) {
  if (!app?.documents?.length) return null;
  try { return app.activeDocument || null; } catch (_) { return null; }
}
function noDocument() { return { outcome: "no-document", success: false, message: "Create or open a page first." }; }
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
    const error = new Error(failure.message || "Photoshop could not place the asset.");
    error.nativeResult = failure;
    throw error;
  }
}
async function fitAndCenterAsset(layer, target, ps, fitPercent = 0.8) {
  const cw = px(target.width), ch = px(target.height), bounds = readBounds(layer);
  const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top;
  if (![cw, ch, w, h].every(value => Number.isFinite(value) && value > 0)) throw new Error("The PNG has no usable bounds.");
  const factor = Math.min(1, cw * fitPercent / w, ch * fitPercent / h);
  if (factor < 1) await layer.scale(factor * 100, factor * 100, ps.constants.AnchorPosition.MIDDLECENTER);
  const fitted = readBounds(layer), dx = cw / 2 - (fitted.left + fitted.right) / 2, dy = ch / 2 - (fitted.top + fitted.bottom) / 2;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) await layer.translate(dx, dy);
}
async function importPngAsset({ config, fileEntry, targetDocument, photoshop, localFileSystem }) {
  const ps = photoshop || require("photoshop"), target = targetDocument || activeDocument(ps.app);
  if (!target) return noDocument();
  try {
    if (!isPngFile(fileEntry)) throw new Error(`Choose a ${config.noun} PNG file.`);
    if (typeof localFileSystem?.createSessionToken !== "function") throw new Error("PNG placement API is not available.");
    const token = await localFileSystem.createSessionToken(fileEntry);
    return await ps.core.executeAsModal(async context => {
      if (!Array.from(ps.app.documents).some(doc => doc.id === target.id)) return noDocument();
      ps.app.activeDocument = target;
      const host = context?.hostControl;
      if (!host?.suspendHistory || !host?.resumeHistory) throw new Error("Photoshop history API is not available.");
      const previousIds = new Set(allLayers(target.layers).map(layer => layer.id));
      const suspension = await host.suspendHistory({ documentID: target.id, name: config.historyName });
      let complete = false, operationError = null;
      try {
        await nativeAction(ps, { _obj: "placeEvent", null: { _path: token, _kind: "local" }, linked: false,
          freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
          offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
          _options: { dialogOptions: "dontDisplay" } });
        const copies = Array.from(target.activeLayers || []).filter(layer => !previousIds.has(layer.id) && layer.document?.id === target.id);
        if (copies.length !== 1) throw new Error("Photoshop did not select the newly placed PNG layer.");
        const layer = copies[0];
        // Native placement may insert inside the currently selected group.
        // Keep this asset independent and leave all existing group contents intact.
        const first = target.layers[0];
        if (first && first.id !== layer.id) await layer.move(first, ps.constants.ElementPlacement.PLACEBEFORE);
        if (target.layers[0]?.id !== layer.id) throw new Error("Photoshop did not move the new PNG to an independent layer.");
        // At the top there are no existing layers above this asset to release
        // when clearing clipping inherited from the previous selection.
        if (layer.isClippingMask) layer.isClippingMask = false;
        if (layer.isClippingMask) throw new Error("Photoshop could not release the PNG's inherited clipping.");
        layer.name = (config.layerPrefix || "") + fileEntry.name.replace(/\.png$/i, "");
        await fitAndCenterAsset(layer, target, ps, config.fitPercent);
        await nativeAction(ps, { _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } });
        ps.app.activeDocument = target;
        complete = true;
        return { outcome: "success", success: true, layer, message: `${config.title} "${layer.name}" added.` };
      } catch (error) {
        operationError = error;
        console.error(`[${config.title}] Native PNG operation failed`, error);
        throw error;
      } finally {
        ps.app.activeDocument = target;
        try { await host.resumeHistory(suspension, complete); }
        catch (historyError) {
          console.error(`[${config.title}] History ${complete ? "commit" : "rollback"} failed`, historyError);
          if (operationError) historyError.cause = operationError;
          // Best effort if history cannot finish; originals are protected even
          // when a native command added a layer before throwing its exception.
          for (const layer of allLayers(target.layers).filter(layer => !previousIds.has(layer.id))) {
            try { await layer.delete(); } catch (cleanupError) { console.error(`[${config.title}] Asset cleanup failed`, cleanupError); }
          }
          throw historyError;
        }
      }
    }, { commandName: config.historyName });
  } catch (error) {
    console.error(`[${config.title}] PNG import failed`, error);
    return { outcome: "error", success: false, error, message: `${config.errorMessage} ${error?.message || "Please try again."}` };
  }
}
function buildAssetToast(result) {
  if (!result || result.outcome === "cancelled") return null;
  return { message: result.message, type: result.outcome === "success" ? "success" : ["no-document", "no-folder"].includes(result.outcome) ? "warning" : "error" };
}
async function runAddAsset({ config, showAssetDialog, onResult, photoshop, localFileSystem, storage }) {
  let { folder } = await resolveAssetFolder({ config, localFileSystem, storage }), message = "";
  async function report(result) { message = result.message; await onResult?.(result); }
  while (true) {
    const choice = await showAssetDialog({ config, folder, folderPath: await getFolderDisplayPath(folder, localFileSystem), message });
    if (!choice || choice.action === "cancel") return { outcome: "cancelled" };
    try {
      if (choice.action === "set-folder" || choice.action === "change-folder") {
        const changed = await changeAssetFolder({ config, localFileSystem, storage, currentFolder: folder });
        folder = changed.folder;
        if (changed.changed) message = "";
      } else if (choice.action === "select" && folder) {
        try { await validateFolder(folder); } catch (_) {
          removeStoredValue(config.storageKey, storage); folder = null;
          await report({ outcome: "no-folder", message: `${config.title} root folder is unavailable. Set the folder again.` });
          continue;
        }
        const ps = photoshop || require("photoshop"), target = activeDocument(ps.app);
        if (!target) { await report(noDocument()); continue; }
        const fileEntry = await selectPngAsset({ config, folder, localFileSystem });
        if (!fileEntry) continue;
        const result = await importPngAsset({ config, fileEntry, targetDocument: target, photoshop: ps, localFileSystem });
        if (result.outcome === "success") return result;
        await report(result);
      }
    } catch (error) {
      console.error(`[${config.title}] Asset selection failed`, error);
      await report({ outcome: "error", success: false, error, message: `${config.errorMessage} ${error?.message || "Please try again."}` });
    }
  }
}
module.exports = { ASSET_CONFIGS, getAssetConfig, resolveAssetFolder, changeAssetFolder, selectPngAsset, fitAndCenterAsset, importPngAsset, runAddAsset, buildAssetToast };
