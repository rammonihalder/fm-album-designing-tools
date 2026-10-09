"use strict";

const { autoBrightness, autoLevels, autoCurves } = require("./quickCorrections");

const ACTIONS = { brightness: autoBrightness, levels: autoLevels, curves: autoCurves };
const LABELS = { brightness: "Auto Brightness/Contrast", levels: "Auto Levels", curves: "Auto Curves" };

function flatten(layers, output = []) {
  for (const layer of Array.from(layers || [])) {
    output.push(layer);
    flatten(layer.layers, output);
  }
  return output;
}

function findDocument(app, id) {
  return Array.from(app.documents || []).find(doc => doc.id === id);
}

function checkResult(results, operation) {
  if (!Array.isArray(results) || results.length !== 1 || !results[0] ||
      results[0]._obj === "error" || results[0].result < 0 ||
      (results[0].executionStatus !== undefined && results[0].executionStatus !== "success" && results[0].executionStatus !== 0)) {
    throw new Error(results?.[0]?.message || `Photoshop did not confirm ${operation}.`);
  }
  return results[0];
}

async function selectLayer(ps, documentId, layerId, add = false) {
  const descriptor = {
    _obj: "select",
    _target: [{ _ref: "layer", _id: layerId }, { _ref: "document", _id: documentId }],
    makeVisible: false,
    _options: { dialogOptions: "silent" }
  };
  if (add) descriptor.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
  checkResult(await ps.action.batchPlay([descriptor], {}), "layer selection");
}

function isSmartObject(layer, ps) {
  return layer && !layer.isBackgroundLayer &&
    (layer.kind === ps.constants?.LayerKind?.SMARTOBJECT || layer.kind === "smartObject" || layer.kind === 5);
}

async function smartObjectMetadata(ps, documentId, layerId) {
  const getProperty = property => ({
    _obj: "get",
    _target: [{ _property: property }, { _ref: "layer", _id: layerId }, { _ref: "document", _id: documentId }],
    _options: { dialogOptions: "silent" }
  });
  const smartObject = checkResult(await ps.action.batchPlay([getProperty("smartObject")], {}), "Smart Object link-state read");
  const linked = smartObject.smartObject?.linked;
  if (typeof linked !== "boolean") throw new Error("Smart Object link state is unavailable.");
  if (linked) return { linked: true, contentId: null };
  const more = checkResult(await ps.action.batchPlay([getProperty("smartObjectMore")], {}), "Smart Object content-identity read");
  const contentId = more.smartObjectMore?.ID;
  if (!linked && ((typeof contentId !== "string" && typeof contentId !== "number") || String(contentId).length === 0)) {
    throw new Error("Smart Object content identity is unavailable; shared contents cannot be ruled out.");
  }
  return { linked, contentId: linked ? null : String(contentId) };
}

function currentAlbum(ps, albumId) {
  const album = findDocument(ps.app, albumId);
  if (!album) throw new Error("The Album PSD was closed during QUICK EDIT.");
  if (ps.app.activeDocument?.id !== albumId) ps.app.activeDocument = album;
  if (ps.app.activeDocument?.id !== albumId) throw new Error("Could not reactivate the Album PSD.");
  return album;
}

function selectedLayer(album, id, ps) {
  const layer = flatten(album.layers).find(item => item.id === id);
  if (!layer || !isSmartObject(layer, ps)) throw new Error("Selected photo Smart Object changed or is unsupported.");
  return layer;
}

async function restoreSelection(ps, albumId, ids) {
  const album = currentAlbum(ps, albumId);
  for (let i = 0; i < ids.length; i++) {
    if (!flatten(album.layers).some(layer => layer.id === ids[i])) throw new Error("An originally selected album layer is missing.");
    await selectLayer(ps, albumId, ids[i], i !== 0);
  }
  const actual = Array.from(album.activeLayers || [], layer => layer.id);
  if (actual.length !== ids.length || ids.some(id => !actual.includes(id))) {
    throw new Error("Could not restore the original Album PSD layer selection.");
  }
}

function summarize(items, restoreError) {
  const successCount = items.filter(item => item.outcome === "applied" || item.outcome === "updated").length;
  const failedCount = items.length - successCount;
  return {
    success: failedCount === 0 && !restoreError,
    outcome: restoreError ? "restoration-failed" : failedCount ? (successCount ? "partial" : "failed") : "success",
    successCount, failedCount, items,
    ...(restoreError ? { restoreError: restoreError.message } : {})
  };
}

async function runAlbumQuickEdit(kind, { photoshop, applyCorrection } = {}) {
  const ps = photoshop || require("photoshop");
  const apply = applyCorrection || ((requested, options) => ACTIONS[requested](options));
  if (!ACTIONS[kind]) throw new Error("Unknown QUICK EDIT correction.");
  if (typeof ps.core?.executeAsModal !== "function" || typeof ps.action?.batchPlay !== "function") {
    throw new Error("Photoshop modal execution or batchPlay is unavailable.");
  }
  const album = ps.app?.activeDocument;
  // When launched inside an already-open photo PSB, operate in place.
  // Never save or close a user-opened document.
  if (album && Number.isInteger(album.id) && /\.psb$/i.test(String(album.name || album.title || ""))) {
    const direct = await apply(kind, { photoshop: ps, mode: "composite" });
    if (!direct?.success || !["applied", "updated"].includes(direct.outcome)) {
      throw new Error(direct?.message || "The PSB correction was not applied.");
    }
    return summarize([{ layerId: null, layerName: album.name, outcome: direct.outcome }], null);
  }
  if (!album || !Number.isInteger(album.id) || !/\.psd$/i.test(String(album.name || ""))) {
    throw new Error("Open an Album PSD and select photo Smart Object layers.");
  }
  const originalIds = Array.from(album.activeLayers || [], layer => layer.id);
  if (!originalIds.length || originalIds.some(id => !Number.isInteger(id)) || new Set(originalIds).size !== originalIds.length) {
    throw new Error("Select one or more photo Smart Object layers in the Album PSD.");
  }
  const originalNames = new Map(flatten(album.layers).map(layer => [layer.id, layer.name]));
  const selectedSet = new Set(originalIds);
  const orderedIds = flatten(album.layers).filter(layer => selectedSet.has(layer.id)).map(layer => layer.id);
  if (orderedIds.length !== originalIds.length) throw new Error("Selected album layers could not be resolved.");

  let result;
  let operationError;
  try {
    result = await ps.core.executeAsModal(async context => {
    const control = context?.hostControl;
    if (typeof control?.registerAutoCloseDocument !== "function" || typeof control?.unregisterAutoCloseDocument !== "function") {
      throw new Error("Photoshop-owned inner-document cleanup is unavailable.");
    }
    const items = [];
      if (ps.app.activeDocument?.id !== album.id) throw new Error("The active Album PSD changed before QUICK EDIT began.");
      const liveIds = Array.from(album.activeLayers || [], layer => layer.id);
      if (liveIds.length !== originalIds.length || originalIds.some(id => !liveIds.includes(id))) {
        throw new Error("The album layer selection changed before QUICK EDIT began.");
      }
      const metadata = new Map();
      let scanError = null;
      for (const layer of flatten(album.layers).filter(layer => isSmartObject(layer, ps))) {
        try { metadata.set(layer.id, await smartObjectMetadata(ps, album.id, layer.id)); }
        catch (error) { scanError = error; break; }
      }
      for (let index = 0; index < orderedIds.length; index++) {
        const id = orderedIds[index];
        const layerName = originalNames.get(id) || `Layer ${id}`;
        if (context.isCancelled) {
          items.push({ layerId: id, layerName, outcome: "cancelled", message: "QUICK EDIT was cancelled." });
          continue;
        }
        let inner = null;
        let owned = [];
        const registeredIds = new Set();
        let saved = false;
        let beforeIds = null;
        let failure = null;
        try {
          const parent = currentAlbum(ps, album.id);
          const layer = selectedLayer(parent, id, ps);
          if (layer.name !== layerName) throw new Error("Selected photo layer changed during QUICK EDIT.");
          if (scanError) throw scanError;
          const info = metadata.get(id);
          if (!info) throw new Error("Smart Object metadata was not found.");
          if (info.linked) throw new Error("Linked Smart Objects are not edited by QUICK EDIT.");
          if (Array.from(metadata.entries()).some(([otherId, other]) => otherId !== id && !other.linked && other.contentId === info.contentId)) {
            throw new Error("This Smart Object shares its embedded contents with another album layer.");
          }
          const fresh = await smartObjectMetadata(ps, album.id, id);
          if (fresh.linked || fresh.contentId !== info.contentId) throw new Error("Smart Object contents changed before editing.");
          await selectLayer(ps, album.id, id);
          if (parent.activeLayers?.length !== 1 || parent.activeLayers[0].id !== id) throw new Error("Could not isolate the selected photo layer.");
          beforeIds = new Set(Array.from(ps.app.documents || [], doc => doc.id));
          const openResult = await ps.action.batchPlay([{ _obj: "placedLayerEditContents", _options: { dialogOptions: "silent" } }], {});
          owned = Array.from(ps.app.documents || []).filter(doc => !beforeIds.has(doc.id) && doc.id !== album.id);
          for (const doc of owned) {
            await control.registerAutoCloseDocument(doc.id);
            registeredIds.add(doc.id);
          }
          if (owned.length === 1) inner = owned[0];
          checkResult(openResult, "Smart Object contents opening");
          if (!inner || ps.app.activeDocument?.id !== inner.id) {
            throw new Error("Photoshop did not open one new owned Smart Object document.");
          }
          if (!/\.psb$/i.test(String(inner.name || ""))) throw new Error("The opened Smart Object is not a PSB; no source file will be modified.");
          // Correct the complete visible PSB composite, including existing
          // retouching and background layers. No stamp or flatten is created.
          // Reuse the surrounding album modal context: nested executeAsModal
          // can collide with Photoshop's exclusive modal scope.
          if (context.isCancelled) throw new Error("QUICK EDIT was cancelled before correcting the inner PSB.");
          const result = await apply(kind, { photoshop: ps, mode: "composite", modalContext: context });
          if (!result?.success || !["applied", "updated"].includes(result.outcome)) {
            throw new Error(result?.message || "The inner correction was not applied.");
          }
          if (context.isCancelled) throw new Error("QUICK EDIT was cancelled before saving the inner PSB.");
          if (ps.app.activeDocument?.id !== inner.id || !findDocument(ps.app, inner.id)) {
            throw new Error("The opened Smart Object document changed before save.");
          }
          if (typeof inner.save !== "function" || typeof inner.close !== "function" ||
              ps.constants?.SaveOptions?.DONOTSAVECHANGES === undefined) {
            throw new Error("Safe PSB save and close APIs are unavailable.");
          }
          await inner.save();
          saved = true;
          await inner.close(ps.constants.SaveOptions.DONOTSAVECHANGES);
          if (findDocument(ps.app, inner.id)) throw new Error("The saved inner PSB remained open.");
          await control.unregisterAutoCloseDocument(inner.id);
          registeredIds.delete(inner.id);
          currentAlbum(ps, album.id);
          items.push({ layerId: id, layerName, outcome: result.outcome });
        } catch (error) {
          failure = error;
          if (beforeIds) {
            owned = Array.from(ps.app.documents || []).filter(doc => !beforeIds.has(doc.id) && doc.id !== album.id)
              .concat(owned.filter(doc => !findDocument(ps.app, doc.id)));
          }
          for (const doc of owned) {
            if (findDocument(ps.app, doc.id) && !registeredIds.has(doc.id)) {
              try {
                await control.registerAutoCloseDocument(doc.id);
                registeredIds.add(doc.id);
              } catch (registerError) {
                failure = new Error(`${failure.message}; auto-close registration failed: ${registerError.message}`);
              }
            }
          }
          for (const doc of owned.filter(doc => findDocument(ps.app, doc.id))) {
            try {
              ps.app.activeDocument = doc;
              if (typeof doc.close !== "function" || ps.constants?.SaveOptions?.DONOTSAVECHANGES === undefined) {
                throw new Error("Safe close API is unavailable.");
              }
              await doc.close(ps.constants.SaveOptions.DONOTSAVECHANGES);
            } catch (cleanupError) {
              failure = new Error(`${failure.message}; inner PSB cleanup failed: ${cleanupError.message}`);
            }
          }
          for (const idToUnregister of registeredIds) {
            if (!findDocument(ps.app, idToUnregister)) {
              try { await control.unregisterAutoCloseDocument(idToUnregister); }
              catch (unregisterError) { failure = new Error(`${failure.message}; cleanup registration failed: ${unregisterError.message}`); }
            }
          }
          const cancelled = context.isCancelled && !saved && !owned.some(doc => findDocument(ps.app, doc.id));
          items.push({ layerId: id, layerName, outcome: saved ? "saved-close-failed" : cancelled ? "cancelled" : "failed", message: failure.message });
          if (saved || owned.some(doc => findDocument(ps.app, doc.id))) {
            for (const pendingId of orderedIds.slice(index + 1)) {
              items.push({ layerId: pendingId, layerName: originalNames.get(pendingId) || `Layer ${pendingId}`,
                outcome: "not-processed", message: "Stopped after an inner Smart Object could not be safely closed." });
            }
            break;
          }
        } finally {
          if (!context.isCancelled && findDocument(ps.app, album.id)) currentAlbum(ps, album.id);
        }
      }
      return summarize(items, null);
    }, { commandName: `FM ${LABELS[kind]}` });
  } catch (error) {
    operationError = error;
  }
  let restoreError = null;
  try {
    await ps.core.executeAsModal(async () => restoreSelection(ps, album.id, originalIds),
      { commandName: "FM Restore Album Selection" });
  } catch (error) {
    restoreError = error;
  }
  if (operationError) {
    if (restoreError) operationError.message += `; selection restoration failed: ${restoreError.message}`;
    throw operationError;
  }
  return restoreError ? summarize(result.items, restoreError) : result;
}

module.exports = { runAlbumQuickEdit };
