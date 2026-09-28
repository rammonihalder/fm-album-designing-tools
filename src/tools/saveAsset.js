"use strict";
const {
  ASSET_LIBRARY_ROOT_KEY,
  DEFAULT_CATEGORY,
  validateCategory,
  resolveAssetLibraryRoot,
  changeAssetLibraryRoot,
  ensureCategoryFolder,
  reserveAssetFile,
  getFolderDisplayPath,
  validateRoot
} = require("./assetLibrary");
const { snapshotDocumentIds } = require("../documentOwnership");
const { readBounds, px, trimTransparentPixels, saveDocumentCopyPng } = require("../photoshop");

function captureAssetSource(app) {
  let source;
  try { source = app?.documents?.length ? app.activeDocument : null; } catch (_) {}
  if (!source) return { outcome: "no-document", success: false, message: "Open a PSD first." };
  const selection = Array.from(source.activeLayers || []);
  if (!selection.length) return { outcome: "no-selection", success: false, message: "Select one or more asset layers first." };
  const selectedIds = new Set(selection.map(layer => layer.id)), layers = [], clipping = new Map(), clippingBases = new Map();

  function visit(collection) {
    const siblings = Array.from(collection || []);
    for (let index = 0; index < siblings.length; index++) {
      const layer = siblings[index];
      if (selectedIds.has(layer.id)) {
        layers.push(layer);
        if (typeof layer.isClippingMask === "boolean") {
          const base = siblings.slice(index + 1).find(item => !item.isClippingMask);
          clippingBases.set(layer.id, layer.isClippingMask && base ? base.id : null);
        }
      } else if (layer.layers?.length) {
        visit(layer.layers);
      }
    }
  }
  visit(source.layers);
  if (!layers.length) throw new Error("The selected asset layers are no longer available.");

  let exportBaseId = null;
  for (const layer of [...layers].reverse()) {
    const baseId = clippingBases.get(layer.id);
    const retainsBase = baseId != null && baseId === exportBaseId;
    if (clippingBases.has(layer.id)) clipping.set(layer.id, retainsBase);
    if (!retainsBase) exportBaseId = layer.id;
  }

  const bounds = new Map();
  for (const layer of layers) {
    try { bounds.set(layer.id, readBounds(layer)); } catch (_) {}
  }

  return {
    source,
    layers,
    selectionIds: selection.map(layer => layer.id),
    bounds,
    clipping,
    clippingBases,
    width: px(source.width),
    height: px(source.height),
    resolution: source.resolution,
    mode: source.mode,
    depth: source.bitsPerChannel,
    profile: source.colorProfileName,
    pixelAspectRatio: source.pixelAspectRatio
  };
}

function documentOptions(snapshot, photoshop, name) {
  const constants = photoshop?.constants || {};
  const newModes = constants.NewDocumentMode || {};
  const options = {
    width: snapshot.width,
    height: snapshot.height,
    resolution: snapshot.resolution,
    mode: newModes.RGB || "RGBColorMode",
    fill: "transparent",
    name
  };
  const depths = constants.BitsPerChannelType || {};
  const depth = [[8, depths.EIGHT], [16, depths.SIXTEEN], [32, depths.THIRTYTWO]].find(
    ([number, value]) => snapshot.depth === number || (value !== undefined && snapshot.depth === value)
  )?.[0];
  if (depth) options.depth = depth;
  if (snapshot.profile && snapshot.profile !== "None") options.profile = snapshot.profile;
  return options;
}

async function duplicateSelectedLayer(layer, source, target, photoshop) {
  const previous = new Set(Array.from(target.layers, item => item.id));
  function validate(copy) {
    const created = Array.from(target.layers).filter(item => !previous.has(item.id));
    if (!copy || copy.document?.id !== target.id || created.length !== 1 || created[0].id !== copy.id) {
      throw new Error("Photoshop did not return one new export layer.");
    }
    return copy;
  }
  photoshop.app.activeDocument = source;
  try {
    return validate(await layer.duplicate(target));
  } catch (primaryError) {
    console.error("[SAVE ASSET] Layer duplicate failed", { name: layer.name, id: layer.id, kind: layer.kind, error: primaryError });
    try {
      photoshop.app.activeDocument = target;
      for (const partial of Array.from(target.layers).filter(item => !previous.has(item.id))) {
        await partial.delete();
      }
      photoshop.app.activeDocument = source;
      const copies = Array.from(await source.duplicateLayers([layer], target) || []);
      if (copies.length !== 1) throw new Error("Photoshop did not return one layer from the export fallback.");
      return validate(copies[0]);
    } catch (error) {
      console.error("[SAVE ASSET] Layer fallback failed", { name: layer.name, id: layer.id, error });
      const failure = new Error(`Could not copy asset layer "${layer.name}". ${error?.message || ""}`);
      failure.cause = error;
      failure.primaryError = primaryError;
      throw failure;
    }
  }
}

async function restoreSource(snapshot, photoshop) {
  const { source, selectionIds } = snapshot;
  if (!Array.from(photoshop.app.documents).some(doc => doc.id === source.id)) return;
  photoshop.app.activeDocument = source;
  const current = Array.from(source.activeLayers || [], layer => layer.id);
  if (selectionIds.length === current.length && selectionIds.every(id => current.includes(id))) return;
  const descriptors = selectionIds.map((id, index) => ({
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    ...(index ? { selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" } } : {}),
    makeVisible: false,
    _options: { dialogOptions: "dontDisplay" }
  }));
  const results = await photoshop.action.batchPlay(descriptors, {});
  const failed = results?.find(result => result?._obj === "error" || result?.result < 0);
  if (failed) throw new Error(failed.message || "Could not restore source layer selection.");
}

function exportError(error) {
  console.error("[SAVE ASSET] Export failed", error);
  return { outcome: "error", success: false, error, message: `Could not save asset PNG. ${error?.message || "Please try again."}` };
}

async function exportSelectedAsset({ sourceSnapshot, root, category = DEFAULT_CATEGORY, photoshop, localFileSystem } = {}) {
  const ps = photoshop || require("photoshop");
  const snapshot = sourceSnapshot || captureAssetSource(ps.app);
  if (snapshot.outcome) return snapshot;
  if (!root) return { outcome: "no-folder", success: false, message: "Set an asset library folder first." };

  let file, saved = false;
  try {
    const validCategory = validateCategory(category);
    const destination = await ensureCategoryFolder(root, validCategory);
    file = await reserveAssetFile(destination, validCategory);

    await ps.core.executeAsModal(async context => {
      const { source, layers } = snapshot;
      const existingIds = snapshotDocumentIds(ps.app.documents);
      if (!existingIds.has(source.id)) throw new Error("The source PSD is no longer open.");
      let temp, operationError, registered = false;
      try {
        ps.app.activeDocument = source;
        temp = await ps.app.documents.add(documentOptions(snapshot, ps, file.name));
        if (!temp || existingIds.has(temp.id)) throw new Error("Photoshop did not create a new export document.");
        if (context?.hostControl?.registerAutoCloseDocument) {
          await context.hostControl.registerAutoCloseDocument(temp.id);
          registered = true;
        }
        const blanks = Array.from(temp.layers);
        if (Number.isFinite(snapshot.pixelAspectRatio)) temp.pixelAspectRatio = snapshot.pixelAspectRatio;
        const copies = [];
        for (const layer of [...layers].reverse()) {
          copies.unshift({ original: layer, copy: await duplicateSelectedLayer(layer, source, temp, ps) });
        }
        ps.app.activeDocument = temp;
        for (const blank of blanks) await blank.delete();
        for (const { original, copy } of copies) {
          const before = snapshot.bounds.get(original.id);
          if (before) {
            const after = readBounds(copy);
            if (Math.abs(before.right - before.left - (after.right - after.left)) < 0.01 &&
                Math.abs(before.bottom - before.top - (after.bottom - after.top)) < 0.01) {
              const dx = before.left - after.left, dy = before.top - after.top;
              if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) await copy.translate(dx, dy);
            }
          }
        }
        for (const { original, copy } of [...copies].reverse()) {
          if (snapshot.clipping.has(original.id) && copy.isClippingMask !== snapshot.clipping.get(original.id)) {
            copy.isClippingMask = snapshot.clipping.get(original.id);
          }
        }
        for (const { original, copy } of copies) {
          if (snapshot.clipping.has(original.id) && copy.isClippingMask !== snapshot.clipping.get(original.id)) {
            throw new Error(`Could not preserve clipping for asset layer "${original.name}".`);
          }
        }
        const exportStack = Array.from(temp.layers);
        if (exportStack.length !== copies.length || exportStack.some((layer, index) => layer.id !== copies[index].copy.id)) {
          throw new Error("Photoshop did not preserve the selected asset layer order.");
        }
        for (let index = 0; index < copies.length; index++) {
          const { original, copy } = copies[index];
          if (copy.isClippingMask) {
            const base = copies.slice(index + 1).find(item => !item.copy.isClippingMask);
            if (!base || base.original.id !== snapshot.clippingBases.get(original.id)) {
              throw new Error(`Could not preserve the clipping base for asset layer "${original.name}".`);
            }
          }
        }
        await trimTransparentPixels(temp, ps);
        await saveDocumentCopyPng(temp, file, { copy: true, photoshop: ps, localFileSystem });
        saved = true;
      } catch (error) {
        operationError = error;
        console.error("[SAVE ASSET] Native export operation failed", error);
        throw error;
      } finally {
        const owned = Array.from(ps.app.documents).filter(doc => !existingIds.has(doc.id));
        let cleanupError;
        for (const document of owned) {
          try {
            await document.closeWithoutSaving();
            if (registered && document.id === temp?.id) {
              await context.hostControl.unregisterAutoCloseDocument?.(document.id);
            }
          } catch (error) {
            console.error("[SAVE ASSET] Temporary document cleanup failed", error);
            cleanupError = error;
          }
        }
        try {
          await restoreSource(snapshot, ps);
        } catch (error) {
          console.error("[SAVE ASSET] Source selection restore failed", error);
          cleanupError = cleanupError || error;
        }
        if (cleanupError) {
          if (operationError) cleanupError.cause = operationError;
          throw cleanupError;
        }
      }
    }, { commandName: "Save Asset" });

    return {
      outcome: "success",
      success: true,
      fileName: file.name,
      category: validCategory,
      message: `Saved asset: ${validCategory} / ${file.name}`
    };
  } catch (error) {
    const result = exportError(error);
    if (saved) result.message += ` Saved file: ${category} / ${file.name}`;
    return result;
  } finally {
    if (file && !saved) {
      try { await file.delete(); } catch (error) { console.error("[SAVE ASSET] Unfinished file cleanup failed", error); }
    }
  }
}

function buildSaveAssetToast(result) {
  if (!result || result.outcome === "cancelled") return null;
  return {
    message: result.message,
    type: result.outcome === "success" ? "success" : ["no-document", "no-selection", "no-folder"].includes(result.outcome) ? "warning" : "error"
  };
}

async function runSaveAsset({ photoshop, localFileSystem, storage, showSaveAssetDialog, onResult } = {}) {
  const ps = photoshop || require("photoshop");
  const sourceSnapshot = captureAssetSource(ps.app);
  if (sourceSnapshot.outcome) return sourceSnapshot;

  let { folder } = await resolveAssetLibraryRoot({ localFileSystem, storage });
  let category = DEFAULT_CATEGORY;
  let message = "";

  async function report(result) {
    message = result.message;
    await onResult?.(result);
  }

  while (true) {
    const choice = await showSaveAssetDialog({
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
      } else if (choice.action === "save") {
        if (!folder) {
          await report({ outcome: "no-folder", message: "Set an asset library folder first." });
          continue;
        }
        try {
          await validateRoot(folder);
        } catch (error) {
          console.error("[SAVE ASSET] Asset library root unavailable", error);
          const { removeStoredValue } = require("../folderMemory");
          removeStoredValue(ASSET_LIBRARY_ROOT_KEY, storage);
          folder = null;
          await report({ outcome: "no-folder", message: "Asset library folder is unavailable. Set the folder again." });
          continue;
        }
        const result = await exportSelectedAsset({
          sourceSnapshot,
          root: folder,
          category,
          photoshop: ps,
          localFileSystem
        });
        if (result.outcome === "success") return result;
        await report(result);
      }
    } catch (error) {
      await report(exportError(error));
    }
  }
}

module.exports = {
  captureAssetSource,
  exportSelectedAsset,
  runSaveAsset,
  buildSaveAssetToast
};
