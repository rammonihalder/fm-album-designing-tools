"use strict";

const { flattenLayers } = require("../layers");
const { selectLayerById, selectLayersByIds } = require("../photoshop");

function isSmartObjectLayer(layer) {
  if (!layer) return false;
  if (layer.isBackgroundLayer || layer.background || layer.kind === "background") return false;
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

function isEligibleFlipLayer(layer) {
  if (!layer) return false;
  if (layer.isBackgroundLayer || layer.background || layer.kind === "background") return false;
  if (isGroupLayer(layer) || isTextLayer(layer)) return false;

  const kindStr = String(layer.kind || "").toLowerCase();
  if (
    kindStr === "adjustment" ||
    kindStr === "solidcolor" ||
    kindStr === "vector" ||
    layer.kind === 2 || // Adjustment layer
    layer.kind === "adjustment"
  ) {
    return false;
  }

  if (isSmartObjectLayer(layer)) {
    return true;
  }

  // Normal pixel layers
  if (kindStr === "normal" || kindStr === "pixel" || layer.kind === 1 || layer.kind === "pixel") {
    return true;
  }

  return false;
}

function buildFlipPhotoToast(result) {
  if (!result) return { message: "Photo flip failed", type: "error" };

  switch (result.outcome) {
    case "no-document":
      return { message: "Open a document first", type: "warning" };
    case "no-eligible":
      return { message: "Select photo layer first", type: "warning" };
    case "success": {
      const count = result.flippedCount || 1;
      return {
        message: `${count} ${count === 1 ? "photo" : "photos"} flipped`,
        type: "success"
      };
    }
    case "mixed": {
      const flipped = result.flippedCount || 0;
      const skipped = result.skippedCount || 0;
      return {
        message: `${flipped} flipped • ${skipped} skipped`,
        type: "warning"
      };
    }
    case "error":
    case "failed":
    default:
      return { message: "Photo flip failed", type: "error" };
  }
}

async function executeFlipPhotos(dependencies = {}) {
  let app = dependencies.app;
  let core = dependencies.core;
  let action = dependencies.action;

  if (!app || !core || !action) {
    try {
      const photoshop = require("photoshop");
      if (!app) app = photoshop?.app;
      if (!core) core = photoshop?.core;
      if (!action) action = photoshop?.action;
    } catch (_) {}
  }

  const getActiveDocument = dependencies.getActiveDocument || (() => app?.activeDocument);
  const doc = getActiveDocument();
  if (!doc || !doc.id) {
    return {
      success: false,
      outcome: "no-document",
      message: "Open a document first"
    };
  }

  const getSelectedLayers = dependencies.getSelectedLayers || (() => doc.activeLayers || []);
  const selectedLayers = getSelectedLayers();

  if (!selectedLayers || selectedLayers.length === 0) {
    return {
      success: false,
      outcome: "no-eligible",
      message: "Select photo layer first"
    };
  }

  const originalSelectedIds = selectedLayers.map(l => l.id).filter(id => id !== undefined);

  const eligibleLayers = [];
  let skippedCount = 0;

  for (const layer of selectedLayers) {
    if (isEligibleFlipLayer(layer)) {
      eligibleLayers.push(layer);
    } else {
      skippedCount++;
    }
  }

  if (eligibleLayers.length === 0) {
    return {
      success: false,
      outcome: "no-eligible",
      flippedCount: 0,
      skippedCount,
      message: "Select photo layer first"
    };
  }

  const executeModal = dependencies.executeModal || (async (fn, name) => {
    if (core && typeof core.executeAsModal === "function") {
      return core.executeAsModal(async executionContext => fn(executionContext), {
        commandName: name || "Flip Photos"
      });
    }
    return fn({});
  });

  const selectLayer = dependencies.selectLayerById || selectLayerById;
  const selectLayers = dependencies.selectLayersByIds || selectLayersByIds;
  const flipSingle = dependencies.flipLayerHorizontal || (async (layer) => {
    if (action && typeof action.batchPlay === "function") {
      await selectLayer(layer.id);
      return action.batchPlay([
        {
          _obj: "flip",
          axis: {
            _enum: "orientation",
            _value: "horizontal"
          },
          _options: { dialogOptions: "dontDisplay" }
        }
      ], {});
    }
    if (typeof layer.flip === "function") {
      return layer.flip("horizontal");
    }
    if (typeof layer.scale === "function") {
      return layer.scale(-100, 100);
    }
  });

  let flippedCount = 0;
  let flipErrors = [];

  try {
    await executeModal(async (executionContext) => {
      let suspension = null;
      if (executionContext?.hostControl?.suspendHistory && doc) {
        try {
          suspension = await executionContext.hostControl.suspendHistory({
            documentID: doc.id,
            name: "Flip Photos"
          });
        } catch (_) {}
      }

      try {
        for (const layer of eligibleLayers) {
          try {
            await flipSingle(layer);
            flippedCount++;
          } catch (layerErr) {
            console.warn(`[Flip Photo] Failed to flip layer ${layer.name || layer.id}:`, layerErr);
            flipErrors.push(layerErr);
            skippedCount++;
          }
        }
      } finally {
        if (suspension && executionContext?.hostControl?.resumeHistory) {
          try {
            await executionContext.hostControl.resumeHistory(suspension);
          } catch (_) {}
        }
      }
    }, "Flip Photos");
  } catch (modalError) {
    console.error("[Flip Photo] Modal execution failed:", modalError);
    return {
      success: false,
      outcome: "error",
      error: modalError,
      message: "Photo flip failed"
    };
  } finally {
    // Restore selection
    try {
      if (originalSelectedIds.length > 0 && typeof selectLayers === "function") {
        await selectLayers(originalSelectedIds);
      }
    } catch (_) {}
  }

  if (flippedCount === 0 && skippedCount > 0) {
    return {
      success: false,
      outcome: "no-eligible",
      flippedCount: 0,
      skippedCount,
      message: "Select photo layer first"
    };
  }

  if (skippedCount > 0) {
    return {
      success: true,
      outcome: "mixed",
      flippedCount,
      skippedCount,
      message: `${flippedCount} flipped • ${skippedCount} skipped`
    };
  }

  return {
    success: true,
    outcome: "success",
    flippedCount,
    skippedCount: 0,
    message: `${flippedCount} ${flippedCount === 1 ? "photo" : "photos"} flipped`
  };
}

async function runFlipPhoto(dependencies = {}) {
  return executeFlipPhotos(dependencies);
}

module.exports = {
  isSmartObjectLayer,
  isGroupLayer,
  isTextLayer,
  isEligibleFlipLayer,
  buildFlipPhotoToast,
  executeFlipPhotos,
  runFlipPhoto
};
