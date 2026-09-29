"use strict";
const { getStoredValue, setStoredValue, removeStoredValue, restoreFolderFromToken, saveFolderToken, getFolderDisplayPath } = require("../folderMemory");
const { snapshotDocumentIds } = require("../documentOwnership");
const { readBounds, px, trimTransparentPixels } = require("../photoshop");
const SAVE_FRAME_ROOT_KEY = "mm_save_frame_root_folder_token";

async function validateRoot(folder) {
  if (folder?.isFolder !== true || typeof folder.getEntries !== "function") throw new Error("Select a readable frame library folder.");
  await folder.getEntries();
}
async function resolveSaveFrameRoot({ localFileSystem, storage } = {}) {
  if (!getStoredValue(SAVE_FRAME_ROOT_KEY, storage)) return { folder: null };
  try {
    const folder = await restoreFolderFromToken(SAVE_FRAME_ROOT_KEY, localFileSystem, storage);
    await validateRoot(folder);
    return { folder };
  } catch (_) { removeStoredValue(SAVE_FRAME_ROOT_KEY, storage); return { folder: null }; }
}
async function changeSaveFrameRoot({ localFileSystem, storage, promptForFolder, currentFolder = null } = {}) {
  const pick = promptForFolder || (() => localFileSystem.getFolder());
  const folder = await pick();
  if (!folder) return { folder: currentFolder, changed: false };
  await validateRoot(folder);
  const previous = getStoredValue(SAVE_FRAME_ROOT_KEY, storage);
  if (!await saveFolderToken(SAVE_FRAME_ROOT_KEY, folder, localFileSystem, storage)) {
    if (previous) setStoredValue(SAVE_FRAME_ROOT_KEY, previous, storage);
    else removeStoredValue(SAVE_FRAME_ROOT_KEY, storage);
    throw new Error("Could not remember the frame library folder.");
  }
  return { folder, changed: true };
}
function validatePhotoCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("Choose a photo count from 1 to 12.");
  return count;
}
async function ensurePhotoFolder(root, photoCount) {
  const name = `${validatePhotoCount(photoCount)} PHOTOS`;
  const existing = (await root.getEntries()).find(entry => String(entry.name).toUpperCase() === name);
  if (existing) {
    if (!existing.isFolder) throw new Error(`A file already uses the folder name ${name}.`);
    return existing;
  }
  return root.createFolder(name);
}
async function reserveFrameFile(folder) {
  const entries = await folder.getEntries();
  let highest = 0;
  for (const entry of entries) {
    const match = entry.isFile && !entry.isFolder && /^Frame (\d+)\.psd$/i.exec(entry.name || "");
    if (match) {
      const number = Number(match[1]);
      if (!Number.isSafeInteger(number)) throw new Error("Frame sequence number is too large.");
      highest = Math.max(highest, number);
    }
  }
  if (!Number.isSafeInteger(highest + 1)) throw new Error("Frame sequence number is too large.");
  return folder.createFile(`Frame ${String(highest + 1).padStart(3, "0")}.psd`, { overwrite: false });
}
function captureFrameSource(app) {
  let source;
  try { source = app?.documents?.length ? app.activeDocument : null; } catch (_) {}
  if (!source) return { outcome: "no-document", success: false, message: "Open a PSD first." };
  const selection = Array.from(source.activeLayers || []);
  if (!selection.length) return { outcome: "no-selection", success: false, message: "Select one or more frame layers first." };
  const selectedIds = new Set(selection.map(layer => layer.id)), layers = [], clipping = new Map(), clippingBases = new Map();
  // A selected group owns all its descendants. Never duplicate a child twice,
  // or bring along an unselected parent when only its child was selected.
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
      }
      else if (layer.layers?.length) visit(layer.layers);
    }
  }
  visit(source.layers);
  if (!layers.length) throw new Error("The selected frame layers are no longer available.");
  let exportBaseId = null;
  for (const layer of [...layers].reverse()) {
    // Promoting a selected child to an export root can interrupt a clipping
    // chain. Retain clipping only to the exact original base, never whichever
    // unrelated selected layer happens to become the nearest base instead.
    const baseId = clippingBases.get(layer.id);
    const retainsBase = baseId != null && baseId === exportBaseId;
    if (clippingBases.has(layer.id)) clipping.set(layer.id, retainsBase);
    if (!retainsBase) exportBaseId = layer.id;
  }
  const bounds = new Map();
  for (const layer of layers) {
    try { bounds.set(layer.id, readBounds(layer)); } catch (_) { /* Some adjustment layers have no usable bounds. */ }
  }
  return { source, layers, selectionIds: selection.map(layer => layer.id), bounds, clipping, clippingBases,
    width: px(source.width), height: px(source.height), resolution: source.resolution,
    mode: source.mode, depth: source.bitsPerChannel, profile: source.colorProfileName, pixelAspectRatio: source.pixelAspectRatio };
}
function documentOptions(snapshot, photoshop, name) {
  const constants = photoshop.constants || {}, modes = constants.DocumentMode || {}, newModes = constants.NewDocumentMode || {};
  const strings = { RGB: "RGBColorMode", CMYK: "CMYKColorMode", GRAYSCALE: "grayscaleMode", LAB: "labColorMode" };
  const key = Object.keys(strings).find(key => snapshot.mode === modes[key] || String(snapshot.mode).toLowerCase() === strings[key].toLowerCase() || String(snapshot.mode).toUpperCase() === key);
  if (!key) console.warn("[SAVE FRAME] Source mode cannot create a transparent layered document; using RGB", snapshot.mode);
  const options = { width: snapshot.width, height: snapshot.height, resolution: snapshot.resolution,
    mode: newModes[key || "RGB"] || strings[key || "RGB"], fill: "transparent", name };
  const depths = constants.BitsPerChannelType || {};
  const depth = [[8, depths.EIGHT], [16, depths.SIXTEEN], [32, depths.THIRTYTWO]].find(([number, value]) => snapshot.depth === number || value !== undefined && snapshot.depth === value)?.[0];
  if (depth) options.depth = depth;
  if (key && snapshot.profile && snapshot.profile !== "None") options.profile = snapshot.profile;
  return options;
}
async function duplicateSelectedLayer(layer, source, target, photoshop) {
  const previous = new Set(Array.from(target.layers, item => item.id));
  function validate(copy) {
    const created = Array.from(target.layers).filter(item => !previous.has(item.id));
    if (!copy || copy.document?.id !== target.id || created.length !== 1 || created[0].id !== copy.id) throw new Error("Photoshop did not return one new export layer.");
    return copy;
  }
  photoshop.app.activeDocument = source;
  try { return validate(await layer.duplicate(target)); }
  catch (primaryError) {
    console.error("[SAVE FRAME] Layer duplicate failed", { name: layer.name, id: layer.id, kind: layer.kind, error: primaryError });
    try {
      photoshop.app.activeDocument = target;
      for (const partial of Array.from(target.layers).filter(item => !previous.has(item.id))) await partial.delete();
      photoshop.app.activeDocument = source;
      const copies = Array.from(await source.duplicateLayers([layer], target) || []);
      if (copies.length !== 1) throw new Error("Photoshop did not return one layer from the export fallback.");
      return validate(copies[0]);
    } catch (error) {
      console.error("[SAVE FRAME] Layer fallback failed", { name: layer.name, id: layer.id, error });
      const failure = new Error(`Could not copy frame layer "${layer.name}". ${error?.message || ""}`);
      failure.cause = error; failure.primaryError = primaryError; throw failure;
    }
  }
}
async function restoreSource(snapshot, photoshop) {
  const { source, selectionIds } = snapshot;
  if (!Array.from(photoshop.app.documents).some(doc => doc.id === source.id)) return;
  photoshop.app.activeDocument = source;
  const current = Array.from(source.activeLayers || [], layer => layer.id);
  if (selectionIds.length === current.length && selectionIds.every(id => current.includes(id))) return;
  const descriptors = selectionIds.map((id, index) => ({ _obj: "select", _target: [{ _ref: "layer", _id: id }],
    ...(index ? { selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" } } : {}),
    makeVisible: false, _options: { dialogOptions: "dontDisplay" } }));
  const results = await photoshop.action.batchPlay(descriptors, {});
  const failed = results?.find(result => result?._obj === "error" || result?.result < 0);
  if (failed) throw new Error(failed.message || "Could not restore source layer selection.");
}
function exportError(error) {
  console.error("[SAVE FRAME] PSD export failed", error);
  return { outcome: "error", success: false, error, message: `Could not save frame PSD. ${error?.message || "Please try again."}` };
}
async function exportSelectedFrame({ sourceSnapshot, root, photoCount, photoshop } = {}) {
  const ps = photoshop || require("photoshop"), snapshot = sourceSnapshot || captureFrameSource(ps.app);
  if (snapshot.outcome) return snapshot;
  let file, saved = false;
  try {
    const count = validatePhotoCount(photoCount);
    const destination = await ensurePhotoFolder(root, count);
    file = await reserveFrameFile(destination);
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
          await context.hostControl.registerAutoCloseDocument(temp.id); registered = true;
        }
        const blanks = Array.from(temp.layers);
        if (Number.isFinite(snapshot.pixelAspectRatio)) temp.pixelAspectRatio = snapshot.pixelAspectRatio;
        const copies = [];
        for (const layer of [...layers].reverse()) copies.unshift({ original: layer, copy: await duplicateSelectedLayer(layer, source, temp, ps) });
        ps.app.activeDocument = temp;
        for (const blank of blanks) await blank.delete();
        for (const { original, copy } of copies) {
          // Native duplication preserves editable contents, masks and effects.
          // Equal canvases normally preserve coordinates. Correct a native
          // translation only when both extents still agree (never resize).
          const before = snapshot.bounds.get(original.id);
          if (before) {
            const after = readBounds(copy);
            if (Math.abs(before.right - before.left - (after.right - after.left)) < 0.01 && Math.abs(before.bottom - before.top - (after.bottom - after.top)) < 0.01) {
              const dx = before.left - after.left, dy = before.top - after.top;
              if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) await copy.translate(dx, dy);
            }
          }
        }
        // Releasing a lower clipping mask releases layers above it. Restore
        // bases first, then clipped layers, and verify the final whole stack.
        for (const { original, copy } of [...copies].reverse()) {
          if (snapshot.clipping.has(original.id) && copy.isClippingMask !== snapshot.clipping.get(original.id)) copy.isClippingMask = snapshot.clipping.get(original.id);
        }
        for (const { original, copy } of copies) {
          if (snapshot.clipping.has(original.id) && copy.isClippingMask !== snapshot.clipping.get(original.id)) throw new Error(`Could not preserve clipping for frame layer "${original.name}".`);
        }
        const exportStack = Array.from(temp.layers);
        if (exportStack.length !== copies.length || exportStack.some((layer, index) => layer.id !== copies[index].copy.id)) throw new Error("Photoshop did not preserve the selected frame layer order.");
        for (let index = 0; index < copies.length; index++) {
          const { original, copy } = copies[index];
          if (copy.isClippingMask) {
            const base = copies.slice(index + 1).find(item => !item.copy.isClippingMask);
            if (!base || base.original.id !== snapshot.clippingBases.get(original.id)) throw new Error(`Could not preserve the clipping base for frame layer "${original.name}".`);
          }
        }
        await trimTransparentPixels(temp, ps);
        if (typeof temp.saveAs?.psd !== "function") throw new Error("Photoshop PSD save API is not available.");
        await temp.saveAs.psd(file, { layers: true, embedColorProfile: true }, true);
        saved = true;
      } catch (error) {
        operationError = error;
        console.error("[SAVE FRAME] Native export operation failed", error);
        throw error;
      } finally {
        // A create command can throw after opening its document. Exclusive
        // modal ownership plus the before-snapshot protects every user tab.
        const owned = Array.from(ps.app.documents).filter(doc => !existingIds.has(doc.id));
        let cleanupError;
        for (const document of owned) {
          try {
            await document.closeWithoutSaving();
            if (registered && document.id === temp?.id) await context.hostControl.unregisterAutoCloseDocument?.(document.id);
          } catch (error) { console.error("[SAVE FRAME] Temporary document cleanup failed", error); cleanupError = error; }
        }
        try { await restoreSource(snapshot, ps); }
        catch (error) { console.error("[SAVE FRAME] Source selection restore failed", error); cleanupError = cleanupError || error; }
        if (cleanupError) {
          if (operationError) cleanupError.cause = operationError;
          throw cleanupError;
        }
      }
    }, { commandName: "Save Frame" });
    return { outcome: "success", success: true, fileName: file.name, category: `${count} PHOTOS`, message: `Saved frame: ${count} PHOTOS / ${file.name}` };
  } catch (error) {
    const result = exportError(error);
    if (saved) result.message += ` Saved file: ${photoCount} PHOTOS / ${file.name}`;
    return result;
  } finally {
    if (file && !saved) {
      try { await file.delete(); } catch (error) { console.error("[SAVE FRAME] Unfinished PSD cleanup failed", error); }
    }
  }
}
function buildSaveFrameToast(result) {
  if (!result || result.outcome === "cancelled") return null;
  return { message: result.message, type: result.outcome === "success" ? "success" : ["no-document", "no-selection", "no-folder"].includes(result.outcome) ? "warning" : "error" };
}
async function runSaveFrame({ photoshop, localFileSystem, storage, showSaveFrameDialog, onResult } = {}) {
  const ps = photoshop || require("photoshop"), sourceSnapshot = captureFrameSource(ps.app);
  if (sourceSnapshot.outcome) return sourceSnapshot;
  let { folder } = await resolveSaveFrameRoot({ localFileSystem, storage }), photoCount = 3, message = "";
  async function report(result) { message = result.message; await onResult?.(result); }
  while (true) {
    const choice = await showSaveFrameDialog({ folder, folderPath: await getFolderDisplayPath(folder, localFileSystem), photoCount, message });
    if (!choice || choice.action === "cancel") return { outcome: "cancelled" };
    try {
      photoCount = validatePhotoCount(choice.photoCount ?? photoCount);
      if (["set-folder", "change-folder"].includes(choice.action)) {
        const changed = await changeSaveFrameRoot({ localFileSystem, storage, currentFolder: folder });
        folder = changed.folder; if (changed.changed) message = "";
      } else if (choice.action === "save") {
        if (!folder) { await report({ outcome: "no-folder", message: "Set a frame library folder first." }); continue; }
        try { await validateRoot(folder); } catch (error) {
          console.error("[SAVE FRAME] Frame library root unavailable", error);
          removeStoredValue(SAVE_FRAME_ROOT_KEY, storage); folder = null;
          await report({ outcome: "no-folder", message: "Frame library folder is unavailable. Set the folder again." }); continue;
        }
        const result = await exportSelectedFrame({ sourceSnapshot, root: folder, photoCount, photoshop: ps });
        if (result.outcome === "success") return result;
        await report(result);
      }
    } catch (error) { await report(exportError(error)); }
  }
}
module.exports = { SAVE_FRAME_ROOT_KEY, captureFrameSource, resolveSaveFrameRoot, changeSaveFrameRoot, ensurePhotoFolder, reserveFrameFile, exportSelectedFrame, runSaveFrame, buildSaveFrameToast, trimTransparentPixels };
