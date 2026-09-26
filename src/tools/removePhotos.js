"use strict";

const {
  deleteLayerById,
  findDocumentById,
  executeRemovePhotosModal
} = require("../photoshop");

const PHOTO_NAME_KEYWORDS = ["IMG", "DSC", "PHOTO", ".JPG", ".JPEG"];

function nameMatchesPhotoFilter(layerName) {
  if (typeof layerName !== "string" || !layerName) return false;
  const upper = layerName.toUpperCase();
  return PHOTO_NAME_KEYWORDS.some(kw => upper.includes(kw));
}

function isGroupLayer(layer) {
  if (!layer) return false;
  return Boolean(
    (layer.layers && Array.isArray(layer.layers)) ||
    layer.typename === "LayerSet" ||
    layer.kind === "group" ||
    layer.kind === 7
  );
}

function isClippingLayer(layer) {
  if (!layer) return false;
  return Boolean(
    layer.isClippingMask === true ||
    layer.grouped === true ||
    layer.clipped === true ||
    layer.group === true
  );
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
  } catch (_) {}

  if (layer.smartObject && typeof layer.smartObject === "object") {
    return true;
  }

  return false;
}

function isRemovePhotoCandidate(layer) {
  if (!layer) return false;
  if (isGroupLayer(layer)) return false;

  const isSO = isSmartObjectLayer(layer);
  const isClipped = isClippingLayer(layer);
  const nameMatches = nameMatchesPhotoFilter(layer.name);

  return Boolean(isSO && isClipped && nameMatches);
}

function collectRemovePhotoCandidates(container, candidates = []) {
  if (!container) return candidates;

  const layers = Array.isArray(container)
    ? container
    : (container.layers ? Array.from(container.layers) : []);

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer) continue;

    if (isGroupLayer(layer)) {
      collectRemovePhotoCandidates(layer, candidates);
    } else if (isRemovePhotoCandidate(layer)) {
      candidates.push(layer);
    }
  }

  return candidates;
}

function buildRemovePhotosToast(result) {
  if (!result) return { message: "Photo removal failed", type: "error" };

  switch (result.outcome) {
    case "no-document":
      return { message: "Open a document first", type: "warning" };
    case "no-matches":
      return { message: "No matching photos found", type: "info" };
    case "success":
      if (result.removedCount === 1) {
        return { message: "1 photo removed", type: "success" };
      }
      return { message: `${result.removedCount} photos removed`, type: "success" };
    case "partial":
      return { message: `${result.removedCount} removed • ${result.failedCount} failed`, type: "warning" };
    case "failed":
    case "error":
    default:
      return { message: "Photo removal failed", type: "error" };
  }
}

function logDiagnostic(metadata) {
  console.error("[REMOVE PHOTOS]", {
    stage: metadata.stage,
    documentId: metadata.documentId,
    documentName: metadata.documentName,
    layerId: metadata.layerId,
    layerName: metadata.layerName,
    isSmartObject: metadata.isSmartObject,
    isClipping: metadata.isClipping,
    nameMatched: metadata.nameMatched,
    errorName: metadata.error?.name || (metadata.error && metadata.error.constructor && metadata.error.constructor.name) || "Error",
    errorMessage: metadata.error?.message || metadata.error?.description || String(metadata.error || ""),
    stack: metadata.error?.stack
  });
}

async function executeRemovePhotos(dependencies = {}, options = {}) {
  const {
    app,
    core,
    getActiveDocument,
    findDocById = findDocumentById,
    deleteLayer = deleteLayerById,
    executeModal
  } = dependencies;

  // 1. Stage: validate-document
  const activeDoc = typeof getActiveDocument === "function"
    ? getActiveDocument()
    : app?.activeDocument;

  if (!activeDoc || !activeDoc.id) {
    return { outcome: "no-document" };
  }

  const documentId = activeDoc.id;
  const documentName = activeDoc.name || "document";

  // 2. Stage: scan-layers & collect-candidates
  const candidates = collectRemovePhotoCandidates(activeDoc, []);
  if (!candidates.length) {
    return {
      outcome: "no-matches",
      documentId,
      documentName,
      removedCount: 0,
      failedCount: 0
    };
  }

  const candidateIds = candidates.map(l => l.id);

  // 3. Stage: execute-deletion in modal
  const runModal = typeof executeModal === "function"
    ? executeModal
    : async (fn, cmd) => {
        if (core && typeof core.executeAsModal === "function") {
          return core.executeAsModal(async executionContext => fn(executionContext), {
            commandName: cmd || "MM Remove Photos"
          });
        }
        return fn();
      };

  let removedCount = 0;
  let failedCount = 0;

  try {
    await runModal(async executionContext => {
      // Re-resolve active document by ID
      const currentDoc = typeof findDocById === "function"
        ? findDocById(documentId, app)
        : (app?.documents ? Array.from(app.documents).find(d => d.id === documentId) : activeDoc);

      if (!currentDoc) {
        throw new Error("Active document is no longer open.");
      }

      if (app && app.activeDocument !== currentDoc) {
        app.activeDocument = currentDoc;
      }

      // History suspension if supported
      let suspension = null;
      if (executionContext?.hostControl && typeof executionContext.hostControl.suspendHistory === "function") {
        try {
          suspension = await executionContext.hostControl.suspendHistory({
            documentID: documentId,
            name: "Remove Photos"
          });
        } catch (suspErr) {
          console.warn("[REMOVE PHOTOS] Could not suspend history:", suspErr);
        }
      }

      try {
        for (const targetId of candidateIds) {
          const candidateLayer = candidates.find(c => c.id === targetId);
          const layerName = candidateLayer?.name || `Layer ${targetId}`;

          try {
            if (typeof deleteLayer === "function") {
              await deleteLayer(targetId, currentDoc);
            } else if (candidateLayer && typeof candidateLayer.delete === "function") {
              await candidateLayer.delete();
            } else {
              throw new Error("Layer deletion API is not available.");
            }
            removedCount++;
          } catch (delError) {
            failedCount++;
            logDiagnostic({
              stage: "delete-layer",
              documentId,
              documentName,
              layerId: targetId,
              layerName,
              isSmartObject: candidateLayer ? isSmartObjectLayer(candidateLayer) : true,
              isClipping: candidateLayer ? isClippingLayer(candidateLayer) : true,
              nameMatched: candidateLayer ? nameMatchesPhotoFilter(candidateLayer.name) : true,
              error: delError
            });
          }
        }
      } finally {
        if (suspension && executionContext?.hostControl && typeof executionContext.hostControl.resumeHistory === "function") {
          try {
            await executionContext.hostControl.resumeHistory(suspension);
          } catch (resErr) {
            console.warn("[REMOVE PHOTOS] Could not resume history:", resErr);
          }
        }
      }
    }, "MM Remove Photos");
  } catch (modalError) {
    logDiagnostic({
      stage: "execute-deletion",
      documentId,
      documentName,
      error: modalError
    });
    if (removedCount === 0) {
      return {
        outcome: "error",
        documentId,
        documentName,
        removedCount: 0,
        failedCount: candidateIds.length,
        error: modalError
      };
    }
  }

  if (removedCount > 0 && failedCount === 0) {
    return { outcome: "success", documentId, documentName, removedCount, failedCount };
  }
  if (removedCount > 0 && failedCount > 0) {
    return { outcome: "partial", documentId, documentName, removedCount, failedCount };
  }
  return { outcome: "failed", documentId, documentName, removedCount: 0, failedCount };
}

async function runRemovePhotos(options = {}) {
  let psApp = null;
  let psCore = null;

  try {
    const photoshop = require("photoshop");
    psApp = photoshop.app;
    psCore = photoshop.core;
  } catch (_) {}

  return executeRemovePhotos({
    app: psApp,
    core: psCore,
    getActiveDocument: () => psApp?.activeDocument,
    findDocById: findDocumentById,
    deleteLayer: deleteLayerById,
    executeModal: executeRemovePhotosModal,
    ...options
  }, options);
}

module.exports = {
  PHOTO_NAME_KEYWORDS,
  nameMatchesPhotoFilter,
  isGroupLayer,
  isClippingLayer,
  isSmartObjectLayer,
  isRemovePhotoCandidate,
  collectRemovePhotoCandidates,
  buildRemovePhotosToast,
  logDiagnostic,
  executeRemovePhotos,
  runRemovePhotos
};
