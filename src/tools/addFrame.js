"use strict";
const { readBounds, px } = require("../photoshop");
const { getStoredValue, setStoredValue, removeStoredValue, restoreFolderFromToken, saveFolderToken, getFolderDisplayPath } = require("../folderMemory");
const { snapshotDocumentIds, classifyOpenedDocument } = require("../documentOwnership");
const FRAME_FOLDER_STORAGE_KEY = "mm_add_frame_folder_token";
const HISTORY_STATE_NAME = "Add PSD Frame";
const MAX_CANVAS_COVERAGE = 0.80;

function isPsdFile(entry) { return Boolean(entry?.isFile && !entry.isFolder && /\.psd$/i.test(entry.name || "")); }
function getPsdLayerName(name) { return typeof name === "string" ? name.replace(/\.psd$/i, "") || "Frame" : "Frame"; }
function getStoredFrameFolderToken(storage) { return getStoredValue(FRAME_FOLDER_STORAGE_KEY, storage); }
function clearFrameFolderToken(storage) { removeStoredValue(FRAME_FOLDER_STORAGE_KEY, storage); }
async function validateFrameFolder(folder) {
  if (folder?.isFolder !== true || typeof folder.getEntries !== "function") throw new Error("Select a readable Frame Root Folder.");
  // Accessibility check only; no PSD enumeration, thumbnails, or custom list.
  await folder.getEntries();
}
async function resolveFrameFolder({ localFileSystem, storage } = {}) {
  if (!getStoredFrameFolderToken(storage)) return { folder: null, wasRemembered: false };
  try {
    const folder = await restoreFolderFromToken(FRAME_FOLDER_STORAGE_KEY, localFileSystem, storage);
    await validateFrameFolder(folder);
    return { folder, wasRemembered: true };
  } catch (_) {
    clearFrameFolderToken(storage);
    return { folder: null, wasRemembered: false };
  }
}
async function changeFrameFolder({ localFileSystem, storage, promptForFolder, currentFolder = null } = {}) {
  const pick = promptForFolder || (typeof localFileSystem?.getFolder === "function" ? () => localFileSystem.getFolder() : null);
  if (!pick) throw new Error("Folder selection API is not available.");
  const selected = await pick();
  if (!selected) return { folder: currentFolder, changed: false, cancelled: true };
  await validateFrameFolder(selected);
  const previousToken = getStoredFrameFolderToken(storage);
  const token = await saveFolderToken(FRAME_FOLDER_STORAGE_KEY, selected, localFileSystem, storage);
  if (!token) {
    if (previousToken) setStoredValue(FRAME_FOLDER_STORAGE_KEY, previousToken, storage);
    else clearFrameFolderToken(storage);
    throw new Error("Could not remember the Frame Root Folder. Please try again.");
  }
  return { folder: selected, changed: true };
}
async function selectPsdFrame({ folder, localFileSystem } = {}) {
  await validateFrameFolder(folder);
  if (typeof localFileSystem?.getFileForOpening !== "function") throw new Error("PSD file selection API is not available.");
  const selected = await localFileSystem.getFileForOpening({ initialLocation: folder, types: ["psd"], allowMultiple: false });
  const file = Array.isArray(selected) ? selected[0] : selected;
  if (!file) return null;
  if (!isPsdFile(file)) throw new Error("Choose a PSD frame file.");
  // The selected file's parent is deliberately never used to update the root.
  return file;
}
function calculateFrameScale({ frameWidth, frameHeight, canvasWidth, canvasHeight, maxCoverage = MAX_CANVAS_COVERAGE } = {}) {
  if (![frameWidth, frameHeight, canvasWidth, canvasHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error("The frame has no usable bounds.");
  const scaleFactor = Math.min(1, canvasWidth * maxCoverage / frameWidth, canvasHeight * maxCoverage / frameHeight);
  return { scalePercent: scaleFactor * 100, scaleFactor, needsScale: scaleFactor < 1 };
}
function calculateCenterTranslation({ frameBounds, canvasWidth, canvasHeight }) {
  return { dx: canvasWidth / 2 - (frameBounds.left + frameBounds.right) / 2,
    dy: canvasHeight / 2 - (frameBounds.top + frameBounds.bottom) / 2 };
}
async function fitAndCenterFrame(group, target, photoshop) {
  const canvasWidth = px(target.width), canvasHeight = px(target.height), b = readBounds(group);
  const { scalePercent, needsScale } = calculateFrameScale({ frameWidth: b.right - b.left, frameHeight: b.bottom - b.top, canvasWidth, canvasHeight });
  if (needsScale) await group.scale(scalePercent, scalePercent, photoshop.constants.AnchorPosition.MIDDLECENTER);
  const { dx, dy } = calculateCenterTranslation({ frameBounds: readBounds(group), canvasWidth, canvasHeight });
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) await group.translate(dx, dy);
}
function activeFrameDocument(app) {
  if (!app?.documents?.length) return null;
  try { return app.activeDocument || null; } catch (_) { return null; }
}
function noDocumentResult() { return { outcome: "no-document", success: false, message: "Create or open a page first." }; }
async function selectGroup(photoshop, group) {
  const results = await photoshop.action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: group.id }],
    makeVisible: false, _options: { dialogOptions: "dontDisplay" } }], {});
  const failure = results?.find(result => /error/i.test(result?._obj || "") || result?.result < 0);
  if (failure) throw new Error(failure.message || "Could not select the imported frame group.");
}
async function duplicateFrameLayer(sourceLayer, source, target, photoshop) {
  const previousIds = new Set(Array.from(target.layers, layer => layer.id));
  function validateCopy(copy) {
    const created = Array.from(target.layers).filter(layer => !previousIds.has(layer.id));
    if (!copy || copy.document?.id !== target.id || created.length !== 1 || created[0].id !== copy.id) {
      throw new Error("Photoshop did not return one new layer in the target document.");
    }
    return copy;
  }
  function logFailure(label, error) {
    console.error(label, { name: sourceLayer.name, kind: sourceLayer.kind, id: sourceLayer.id,
      errorName: error?.name, errorMessage: error?.message, stack: error?.stack });
  }
  photoshop.app.activeDocument = source;
  try {
    return validateCopy(await sourceLayer.duplicate(target));
  } catch (primaryError) {
    logFailure("[ADD FRAME] Layer duplicate failed", primaryError);
    try {
      // A failed native command can still have inserted a copy. Remove only
      // this attempt's new target layers before retrying, never source layers.
      const partialCopies = Array.from(target.layers).filter(layer => !previousIds.has(layer.id));
      if (partialCopies.length) {
        photoshop.app.activeDocument = target;
        for (const layer of partialCopies) await layer.delete();
      }
      photoshop.app.activeDocument = source;
      const copies = Array.from(await source.duplicateLayers([sourceLayer], target) || []);
      if (copies.length !== 1) throw new Error("Photoshop did not return a copy from the single-layer fallback.");
      return validateCopy(copies[0]);
    } catch (fallbackError) {
      logFailure("[ADD FRAME] Layer fallback failed", fallbackError);
      const failure = new Error(`Could not import frame layer:\n"${sourceLayer.name}"\n${fallbackError?.message || "Photoshop could not duplicate this layer."}`);
      failure.cause = fallbackError;
      failure.primaryError = primaryError;
      throw failure;
    }
  }
}

async function importPsdFrame({ fileEntry, photoshop, targetDocument } = {}) {
  const ps = photoshop || require("photoshop");
  const target = targetDocument || activeFrameDocument(ps.app);
  if (!target) return noDocumentResult();
  try {
    if (!isPsdFile(fileEntry)) throw new Error("Choose a PSD frame file.");
    if (typeof ps.core?.executeAsModal !== "function") throw new Error("Photoshop modal API is not available.");
    return await ps.core.executeAsModal(async context => {
      if (!Array.from(ps.app.documents).some(doc => doc.id === target.id)) return noDocumentResult();
      ps.app.activeDocument = target;
      const host = context?.hostControl;
      if (!host?.suspendHistory || !host?.resumeHistory) throw new Error("Photoshop history API is not available.");
      const existingDocuments = snapshotDocumentIds(ps.app.documents);
      const originalLayers = new Set(Array.from(target.layers, layer => layer.id));
      const suspension = await host.suspendHistory({ documentID: target.id, name: HISTORY_STATE_NAME });
      let source = null, ownsSource = false, sourceClosed = false, registered = false, complete = false;
      async function closeSource() {
        if (!ownsSource || sourceClosed) return;
        await source.closeWithoutSaving();
        sourceClosed = true;
        if (registered && host.unregisterAutoCloseDocument) await host.unregisterAutoCloseDocument(source.id);
      }
      try {
        source = await ps.app.open(fileEntry);
        const ownership = classifyOpenedDocument(source, existingDocuments, target.id);
        if (ownership.isAlbum) throw new Error("The active album page cannot be imported as its own frame.");
        if (ownership.wasAlreadyOpen) throw new Error("Close the selected source PSD first, then select it again to import the saved frame.");
        ownsSource = ownership.shouldClose;
        if (!ownsSource) throw new Error("Photoshop did not open the source PSD.");
        console.log("[ADD FRAME] Source document:", { name: source.name, id: source.id });
        console.log("[ADD FRAME] Target document:", { name: target.name, id: target.id });
        if (host.registerAutoCloseDocument) { await host.registerAutoCloseDocument(source.id); registered = true; }
        const topLayers = Array.from(source.layers || []);
        console.log("[ADD FRAME] Top-level layer count:", topLayers.length);
        if (!topLayers.length) throw new Error("The selected PSD has no layers to import.");
        const duplicates = [];
        // New copies are inserted above the previous copy. Transfer whole
        // top-level layers/groups bottom-to-top, then pass copies top-to-bottom.
        for (const sourceLayer of [...topLayers].reverse()) {
          console.log(`[ADD FRAME] Duplicating: ${sourceLayer.name} / ${sourceLayer.kind}`);
          const copy = await duplicateFrameLayer(sourceLayer, source, target, ps);
          duplicates.unshift(copy);
          console.log(`[ADD FRAME] Duplicated: ${sourceLayer.name}`);
        }
        ps.app.activeDocument = target;
        const name = getPsdLayerName(fileEntry.name);
        console.log("[ADD FRAME] Creating group:", name);
        const group = await target.createLayerGroup({ name, fromLayers: duplicates });
        if (!group || originalLayers.has(group.id) || group.kind !== ps.constants.LayerKind.GROUP) throw new Error("Photoshop did not create an editable frame group.");
        await fitAndCenterFrame(group, target, ps);
        await selectGroup(ps, group);
        await closeSource();
        ps.app.activeDocument = target;
        complete = true;
        console.log("[ADD FRAME] Import completed.");
        return { outcome: "success", success: true, groupName: name, group, message: `Frame "${name}" added as an editable group.` };
      } finally {
        let cleanupError = null;
        try { await closeSource(); } catch (error) { cleanupError = error; }
        try { ps.app.activeDocument = target; } catch (error) { cleanupError = cleanupError || error; }
        // Roll back even when the failure occurs after native duplication has
        // created layers but before it returns their IDs, or while closing PSD.
        await host.resumeHistory(suspension, complete && !cleanupError);
        if (cleanupError) throw cleanupError;
      }
    }, { commandName: HISTORY_STATE_NAME });
  } catch (error) {
    console.error("[ADD FRAME]", error);
    return { outcome: "error", success: false, error, message: error?.message || "Could not import the PSD frame." };
  }
}
function buildAddFrameToast(result) {
  if (!result || result.outcome === "cancelled") return null;
  const type = result.outcome === "success" ? "success" : ["no-document", "no-folder"].includes(result.outcome) ? "warning" : "error";
  return { message: result.message || "Could not import the PSD frame.", type };
}
async function runAddFrame({ showAddFrameDialog, onResult, photoshop, localFileSystem, storage, promptForFolder } = {}) {
  if (typeof showAddFrameDialog !== "function") throw new Error("ADD FRAME dialog is not available.");
  let { folder } = await resolveFrameFolder({ localFileSystem, storage });
  let lastResult = null;
  async function report(result) {
    lastResult = result;
    await onResult?.(result);
  }
  while (true) {
    const action = await showAddFrameDialog({ folder, folderPath: await getFolderDisplayPath(folder, localFileSystem), message: lastResult?.message || "" });
    if (!action || action.action === "cancel") return { outcome: "cancelled" };
    try {
      if (action.action === "set-folder" || action.action === "change-folder") {
        const changed = await changeFrameFolder({ localFileSystem, storage, promptForFolder, currentFolder: folder });
        folder = changed.folder;
        if (changed.changed) lastResult = null;
      } else if (action.action === "select") {
        if (!folder) continue;
        try { await validateFrameFolder(folder); } catch (_) {
          clearFrameFolderToken(storage); folder = null;
          await report({ outcome: "no-folder", message: "Frame Root Folder is unavailable. Set the folder again." });
          continue;
        }
        const ps = photoshop || require("photoshop"), target = activeFrameDocument(ps.app);
        if (!target) { await report(noDocumentResult()); continue; }
        const fileEntry = await selectPsdFrame({ folder, localFileSystem });
        if (!fileEntry) continue;
        const result = await importPsdFrame({ fileEntry, photoshop: ps, targetDocument: target });
        if (result.outcome === "success") return result;
        await report(result);
      }
    } catch (error) {
      await report({ outcome: "error", success: false, error, message: error?.message || "ADD FRAME failed." });
    }
  }
}
module.exports = { FRAME_FOLDER_STORAGE_KEY, HISTORY_STATE_NAME, MAX_CANVAS_COVERAGE, isPsdFile, getPsdLayerName,
  getStoredFrameFolderToken, clearFrameFolderToken, resolveFrameFolder, changeFrameFolder, selectPsdFrame,
  calculateFrameScale, calculateCenterTranslation, fitAndCenterFrame, importPsdFrame, buildAddFrameToast, runAddFrame };
