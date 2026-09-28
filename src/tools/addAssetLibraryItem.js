"use strict";
const {
  ASSET_LIBRARY_ROOT_KEY,
  DEFAULT_CATEGORY,
  validateCategory,
  resolveAssetLibraryRoot,
  changeAssetLibraryRoot,
  ensureCategoryFolder,
  getFolderDisplayPath,
  validateRoot
} = require("./assetLibrary");
const { readBounds, px } = require("../photoshop");
const { fitAndCenterAsset } = require("./addAsset");

function isPngFile(entry) {
  return Boolean(entry?.isFile && !entry.isFolder && /\.png$/i.test(entry.name || ""));
}

function activeDocument(app) {
  if (!app?.documents?.length) return null;
  try { return app.activeDocument || null; } catch (_) { return null; }
}

function noDocument() {
  return { outcome: "no-document", success: false, message: "Create or open a page first." };
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
    const error = new Error(failure.message || "Photoshop could not place the asset.");
    error.nativeResult = failure;
    throw error;
  }
}

async function selectLibraryPng({ categoryFolder, localFileSystem } = {}) {
  if (!categoryFolder || typeof categoryFolder.getEntries !== "function") {
    throw new Error("Category folder is not accessible.");
  }
  if (typeof localFileSystem?.getFileForOpening !== "function") {
    throw new Error("PNG file selection API is not available.");
  }
  const selection = await localFileSystem.getFileForOpening({
    initialLocation: categoryFolder,
    types: ["png"],
    allowMultiple: false
  });
  const file = Array.isArray(selection) ? selection[0] : selection;
  if (!file) return null;
  if (!isPngFile(file)) {
    throw new Error("Choose a PNG file.");
  }
  return file;
}

async function importLibraryAsset({ fileEntry, category = DEFAULT_CATEGORY, targetDocument, photoshop, localFileSystem } = {}) {
  const ps = photoshop || require("photoshop");
  const target = targetDocument || activeDocument(ps.app);
  if (!target) return noDocument();

  try {
    if (!isPngFile(fileEntry)) throw new Error("Choose a PNG file.");
    if (typeof localFileSystem?.createSessionToken !== "function") {
      throw new Error("PNG placement API is not available.");
    }
    const token = await localFileSystem.createSessionToken(fileEntry);

    return await ps.core.executeAsModal(async context => {
      if (!Array.from(ps.app.documents).some(doc => doc.id === target.id)) return noDocument();
      ps.app.activeDocument = target;
      const host = context?.hostControl;
      if (!host?.suspendHistory || !host?.resumeHistory) {
        throw new Error("Photoshop history API is not available.");
      }

      const previousIds = new Set(allLayers(target.layers).map(layer => layer.id));
      const suspension = await host.suspendHistory({ documentID: target.id, name: "Add Asset" });
      let complete = false, operationError = null;

      try {
        await nativeAction(ps, {
          _obj: "placeEvent",
          null: { _path: token, _kind: "local" },
          linked: false,
          freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
          offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
          _options: { dialogOptions: "dontDisplay" }
        });

        const copies = Array.from(target.activeLayers || []).filter(
          layer => !previousIds.has(layer.id) && layer.document?.id === target.id
        );
        if (copies.length !== 1) throw new Error("Photoshop did not select the newly placed PNG layer.");
        const layer = copies[0];

        const first = target.layers[0];
        if (first && first.id !== layer.id) {
          await layer.move(first, ps.constants.ElementPlacement.PLACEBEFORE);
        }
        if (target.layers[0]?.id !== layer.id) {
          throw new Error("Photoshop did not move the new PNG to an independent layer.");
        }

        if (layer.isClippingMask) layer.isClippingMask = false;
        if (layer.isClippingMask) throw new Error("Photoshop could not release the PNG's inherited clipping.");

        layer.name = fileEntry.name.replace(/\.png$/i, "");
        await fitAndCenterAsset(layer, target, ps, 0.8);
        await nativeAction(ps, {
          _obj: "select",
          _target: [{ _ref: "layer", _id: layer.id }],
          makeVisible: false,
          _options: { dialogOptions: "dontDisplay" }
        });

        ps.app.activeDocument = target;
        complete = true;
        return {
          outcome: "success",
          success: true,
          layer,
          fileName: fileEntry.name,
          category,
          message: `Added asset "${layer.name}".`
        };
      } catch (error) {
        operationError = error;
        console.error("[ADD ASSET] Native PNG placement failed", error);
        throw error;
      } finally {
        ps.app.activeDocument = target;
        try {
          await host.resumeHistory(suspension, complete);
        } catch (historyError) {
          console.error(`[ADD ASSET] History ${complete ? "commit" : "rollback"} failed`, historyError);
          if (operationError) historyError.cause = operationError;
          for (const layer of allLayers(target.layers).filter(l => !previousIds.has(l.id))) {
            try { await layer.delete(); } catch (cleanupError) { console.error("[ADD ASSET] Asset cleanup failed", cleanupError); }
          }
          throw historyError;
        }
      }
    }, { commandName: "Add Asset" });
  } catch (error) {
    console.error("[ADD ASSET] PNG import failed", error);
    return {
      outcome: "error",
      success: false,
      error,
      message: `Could not add asset. ${error?.message || "Please try again."}`
    };
  }
}

function buildAddAssetToast(result) {
  if (!result || result.outcome === "cancelled") return null;
  return {
    message: result.message,
    type: result.outcome === "success" ? "success" : ["no-document", "no-folder"].includes(result.outcome) ? "warning" : "error"
  };
}

async function runAddAssetLibrary({ photoshop, localFileSystem, storage, showAddAssetDialog, onResult } = {}) {
  let { folder } = await resolveAssetLibraryRoot({ localFileSystem, storage });
  let category = DEFAULT_CATEGORY;
  let message = "";

  async function report(result) {
    message = result.message;
    await onResult?.(result);
  }

  while (true) {
    const choice = await showAddAssetDialog({
      folder,
      folderPath: await getFolderDisplayPath(folder, localFileSystem),
      category,
      message
    });
    if (!choice || choice.action === "cancel") return { outcome: "cancelled" };

    try {
      category = validateCategory(choice.category ?? category);

      if (["set-folder", "change-folder"].includes(choice.action)) {
        const changed = await changeAssetLibraryRoot({ localFileSystem, storage, currentFolder: folder });
        folder = changed.folder;
        if (changed.changed) message = "";
      } else if (choice.action === "select") {
        if (!folder) {
          await report({ outcome: "no-folder", message: "Set an asset library folder first." });
          continue;
        }

        try {
          await validateRoot(folder);
        } catch (error) {
          console.error("[ADD ASSET] Asset library root unavailable", error);
          const { removeStoredValue } = require("../folderMemory");
          removeStoredValue(ASSET_LIBRARY_ROOT_KEY, storage);
          folder = null;
          await report({ outcome: "no-folder", message: "Asset library folder is unavailable. Set the folder again." });
          continue;
        }

        const ps = photoshop || require("photoshop");
        const target = activeDocument(ps.app);
        if (!target) {
          await report(noDocument());
          continue;
        }

        const categoryFolder = await ensureCategoryFolder(folder, category);
        const fileEntry = await selectLibraryPng({ categoryFolder, localFileSystem });
        if (!fileEntry) continue;

        const result = await importLibraryAsset({
          fileEntry,
          category,
          targetDocument: target,
          photoshop: ps,
          localFileSystem
        });
        if (result.outcome === "success") return result;
        await report(result);
      }
    } catch (error) {
      console.error("[ADD ASSET] Asset selection failed", error);
      await report({
        outcome: "error",
        success: false,
        error,
        message: `Could not add asset. ${error?.message || "Please try again."}`
      });
    }
  }
}

module.exports = {
  isPngFile,
  activeDocument,
  noDocument,
  selectLibraryPng,
  importLibraryAsset,
  buildAddAssetToast,
  runAddAssetLibrary
};
